import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  rawBody: "", receivedAt: new Date("2026-09-13T15:00:05Z"), stored: 0, processingStatuses: [] as string[],
  queued: vi.fn(), ingested: vi.fn().mockResolvedValue({ action: "inserted", leadId: "lead-row-1" }),
}));

vi.mock("@/lib/env", () => ({ env: () => ({
  META_APP_SECRET: "app-secret", META_VERIFY_TOKEN: "verify-token", META_SYSTEM_USER_TOKEN: "system-token",
  META_GRAPH_VERSION: "v26.0", DEFAULT_TENANT_ID: "11111111-1111-4111-8111-111111111111", DATABASE_URL: "postgres://unused",
}) }));
vi.mock("@/lib/job-queue", () => ({ enqueueMetaWebhook: harness.queued }));
vi.mock("@/services/lead-intake", () => ({ ingestLead: harness.ingested }));
vi.mock("@/db", () => ({
  withTenant: async (_context: unknown, work: (transaction: unknown) => Promise<unknown>) => {
    const transaction = Object.assign(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      if (query.includes("INSERT INTO app.webhook_events")) { harness.rawBody = String(values[3]); harness.stored += 1; return []; }
      if (query.includes("SELECT m.id,m.source_connection_id")) return [{ id: "meta-connection-1", source_connection_id: "source-connection-1" }];
      if (query.includes("SELECT id,raw_body,received_at,headers")) return [{ id: String(values[1]), raw_body: harness.rawBody, received_at: harness.receivedAt, headers: {} }];
      if (query.includes("SELECT m.source_field,m.target_field")) return [];
      if (query.includes("INSERT INTO app.webhook_processing_events")) {
        harness.processingStatuses.push(query.includes("'processing'") ? "processing" : query.includes("'failed'") ? "failed" : String(values[2]));
        return [];
      }
      return [];
    }, { json: (value: unknown) => value });
    return work(transaction);
  },
}));

import { POST } from "@/app/api/webhooks/meta/route";
import { processMetaWebhookEvent } from "@/services/meta-leads";

function signedRequest(body: string, valid = true) {
  const signature = createHmac("sha256", valid ? "app-secret" : "wrong-secret").update(body).digest("hex");
  return new NextRequest("http://localhost/api/webhooks/meta", { method: "POST", body, headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${signature}` } });
}

describe("Meta webhook pipeline", () => {
  beforeEach(() => { harness.rawBody = ""; harness.stored = 0; harness.processingStatuses.length = 0; harness.queued.mockReset(); harness.queued.mockResolvedValue("job-1"); harness.ingested.mockClear(); });

  it("stores a valid raw payload, queues it, hydrates Graph data and ingests the lead", async () => {
    const body = JSON.stringify({ entry: [{ id: "page-1", changes: [{ field: "leadgen", value: { leadgen_id: "meta-lead-1", form_id: "form-1" } }] }] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "meta-lead-1", created_time: "2026-09-13T15:00:00Z", form_id: "form-1", campaign_name: "Wedding", field_data: [{ name: "full_name", values: ["Riya Shah"] }, { name: "phone_number", values: ["9876543210"] }] }), { status: 200 })));
    const response = await POST(signedRequest(body));
    expect(response.status).toBe(200); expect(harness.stored).toBe(1); expect(harness.rawBody).toBe(body); expect(harness.queued).toHaveBeenCalledOnce();
    const [,eventId] = harness.queued.mock.calls[0];
    await expect(processMetaWebhookEvent("11111111-1111-4111-8111-111111111111", String(eventId))).resolves.toEqual({ ingested: 1 });
    expect(harness.ingested).toHaveBeenCalledOnce();
    expect(harness.ingested.mock.calls[0][2]).toMatchObject({ metaLeadId: "meta-lead-1", fullNameRaw: "Riya Shah", phoneRaw: "9876543210", arrivedAt: new Date("2026-09-13T15:00:00Z") });
  });

  it("rejects an invalid signature without persisting or queueing", async () => {
    const response = await POST(signedRequest('{"entry":[]}', false));
    expect(response.status).toBe(403); expect(harness.stored).toBe(0); expect(harness.queued).not.toHaveBeenCalled();
  });

  it("records a Graph failure so pg-boss can retry it", async () => {
    const body = JSON.stringify({ entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "meta-lead-1", form_id: "form-1" } }] }] });
    harness.rawBody = body; vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 })));
    await expect(processMetaWebhookEvent("11111111-1111-4111-8111-111111111111", "event-1")).rejects.toThrow("Meta Graph API 429");
    expect(harness.processingStatuses).toEqual(["processing", "failed"]);
  });
});
