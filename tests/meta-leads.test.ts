import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeMetaPayload, mapMetaFields, metaGraphRequest, verifyMetaSignature } from "@/lead-sources/meta-lead-form";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Meta Lead Ads", () => {
  it("accepts only the timing-safe sha256 signature for the raw bytes", () => {
    const raw = new TextEncoder().encode('{"entry":[]}'); const secret = "app-secret";
    const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    expect(verifyMetaSignature(raw, signature, secret)).toBe(true);
    expect(verifyMetaSignature(raw, `${signature.slice(0, -1)}0`, secret)).toBe(false);
    expect(verifyMetaSignature(raw, null, secret)).toBe(false);
  });

  it("decodes leadgen changes and tolerates malformed or unknown valid payloads", () => {
    const raw = new TextEncoder().encode(JSON.stringify({ entry: [{ id: "page-1", changes: [{ field: "leadgen", value: { leadgen_id: "lead-1", form_id: "form-1", created_time: 1789300800 } }] }] }));
    const decoded = decodeMetaPayload(raw, new Date(0));
    expect(decoded.ok && decoded.leads[0]?.externalId).toBe("lead-1");
    expect(decodeMetaPayload(new TextEncoder().encode("not-json")).ok).toBe(true);
    expect(decodeMetaPayload(new TextEncoder().encode('{"entry":[]}'))).toEqual({ ok: true, leads: [] });
  });

  it("maps configurable form fields and preserves attribution", () => {
    const candidate = mapMetaFields({ id: "lead-1", created_time: "2026-09-13T15:00:00+0000", form_id: "form-1", campaign_name: "Wedding", ad_name: "Gold", field_data: [{ name: "customer_name", values: ["Riya Shah"] }, { name: "mobile", values: ["9876543210"] }] }, { customer_name: "fullNameRaw", mobile: "phoneRaw" });
    expect(candidate.person).toMatchObject({ fullNameRaw: "Riya Shah", phoneRaw: "9876543210" });
    expect(candidate.attribution).toMatchObject({ campaignName: "Wedding", adName: "Gold" });
  });

  it("hydrates through the Graph contract and surfaces retryable HTTP failures", async () => {
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("graph.facebook.com/v26.0/lead-1");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer server-only-token");
      return new Response(JSON.stringify({ id: "lead-1", created_time: "2026-09-13T15:00:00+0000", field_data: [] }), { status: 200 });
    };
    await expect(metaGraphRequest<{ id: string }>("lead-1?fields=id", { token: "server-only-token", graphVersion: "v26.0", fetchImpl })).resolves.toMatchObject({ id: "lead-1" });
    await expect(metaGraphRequest("lead-1", { token: "server-only-token", graphVersion: "v26.0", fetchImpl: async () => new Response("rate limited", { status: 429 }) })).rejects.toThrow("Meta Graph API 429");
  });

  it("wires persistence-before-queue, retries, reconciliation and cross-source locking", () => {
    const route = read("src/app/api/webhooks/meta/route.ts"); const queue = read("src/lib/job-queue.ts"); const worker = read("src/worker/index.ts"); const intake = read("src/services/lead-intake.ts"); const service = read("src/services/meta-leads.ts");
    expect(route.indexOf("INSERT INTO app.webhook_events")).toBeLessThan(route.lastIndexOf("enqueueMetaWebhook"));
    expect(route).toContain("status: 403");
    expect(queue).toContain("retryBackoff: true");
    expect(worker).toContain('"*/15 * * * *"');
    expect(service).toContain("app.webhook_processing_events");
    expect(intake).toContain("pg_advisory_xact_lock");
    expect(intake).toContain("10 * 60_000");
  });
});
