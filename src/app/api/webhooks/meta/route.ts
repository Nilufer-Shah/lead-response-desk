import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db";
import { verifyMetaSignature } from "@/lead-sources/meta-lead-form";
import { env } from "@/lib/env";
import { enqueueMetaWebhook } from "@/lib/job-queue";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  if (query.get("hub.mode") === "subscribe" && env().META_VERIFY_TOKEN && query.get("hub.verify_token") === env().META_VERIFY_TOKEN) return new NextResponse(query.get("hub.challenge") ?? "", { status: 200 });
  return NextResponse.json({ error: "Webhook verification failed" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const raw = new Uint8Array(await request.arrayBuffer());
  if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), env().META_APP_SECRET ?? "")) return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  const tenantId = env().DEFAULT_TENANT_ID; const rawBody = new TextDecoder().decode(raw); const digest = createHash("sha256").update(raw).digest("hex");
  const eventId = crypto.randomUUID();
  try {
    await withTenant({ tenantId, userRole: "system" }, async (transaction) => {
      await transaction`INSERT INTO app.webhook_events (id,tenant_id,source,headers,raw_body,body_sha256,signature_valid) VALUES (${eventId},${tenantId},'meta_lead_form',${transaction.json(Object.fromEntries(request.headers.entries()))},${rawBody},${digest},true)`;
      await transaction`UPDATE app.meta_connections SET last_webhook_at=clock_timestamp(),updated_at=clock_timestamp() WHERE tenant_id=${tenantId}`;
    });
  } catch (error) {
    console.error("Meta webhook persistence failure", error);
    return NextResponse.json({ error: "Webhook could not be safely persisted" }, { status: 500 });
  }
  try { await enqueueMetaWebhook(tenantId, eventId); }
  catch (error) {
    console.error("Meta webhook queue failure; payload remains persisted", error);
    await withTenant({ tenantId, userRole: "system" }, (transaction) => transaction`INSERT INTO app.webhook_processing_events (tenant_id,webhook_event_id,status,detail) VALUES (${tenantId},${eventId},'queue_failed',${transaction.json({ error: error instanceof Error ? error.message : "Queue unavailable" })})`).catch(() => undefined);
  }
  return NextResponse.json({ accepted: true }, { status: 200 });
}
