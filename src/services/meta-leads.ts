import { withTenant } from "@/db";
import { MetaLeadFormAdapter } from "@/lead-sources/meta-lead-form";
import { ingestLead } from "@/services/lead-intake";

const adapter = new MetaLeadFormAdapter();

async function connection(tenantId: string) {
  const [row] = await withTenant({ tenantId, userRole: "system" }, (transaction) => transaction<{ id: string; source_connection_id: string }[]>`
    SELECT m.id,m.source_connection_id FROM app.meta_connections m WHERE m.tenant_id=${tenantId} ORDER BY m.created_at LIMIT 1`);
  if (!row) throw new Error("Meta source connection is not configured");
  return row;
}

async function ingestCandidate(tenantId: string, candidate: Awaited<ReturnType<MetaLeadFormAdapter["hydrate"]>>, eventPayload: Record<string, unknown>) {
  return withTenant({ tenantId, userRole: "system" }, (transaction) => ingestLead(transaction, tenantId, {
    source: "meta_lead_form", externalId: candidate.externalId, metaLeadId: candidate.externalId, arrivedAt: candidate.sourceCreatedAt,
    fullNameRaw: candidate.person.fullNameRaw, phoneRaw: candidate.person.phoneRaw, emailRaw: candidate.person.emailRaw, city: candidate.person.cityRaw,
    formId: candidate.form?.id, formName: candidate.form?.name, campaignId: candidate.attribution?.campaignId, campaignName: candidate.attribution?.campaignName,
    adsetId: candidate.attribution?.adsetId, adsetName: candidate.attribution?.adsetName, adId: candidate.attribution?.adId, adName: candidate.attribution?.adName,
    customFields: candidate.customFields as Record<string, unknown>, eventPayload,
  }));
}

export async function processMetaWebhookEvent(tenantId: string, webhookEventId: string, signal = new AbortController().signal) {
  const meta = await connection(tenantId);
  const [event] = await withTenant({ tenantId, userRole: "system" }, (transaction) => transaction<{ id: string; raw_body: string; received_at: Date; headers: Record<string, unknown> }[]>`
    SELECT id,raw_body,received_at,headers FROM app.webhook_events WHERE tenant_id=${tenantId} AND id=${webhookEventId}`);
  if (!event) throw new Error("Webhook event was not found");
  const context = { tenantId, connectionId: meta.source_connection_id, signal };
  try {
    await withTenant({ tenantId, userRole: "system" }, (transaction) => transaction`INSERT INTO app.webhook_processing_events (tenant_id,webhook_event_id,status,detail) VALUES (${tenantId},${event.id},'processing','{}')`);
    const decoded = await adapter.decode({ id: event.id, tenantId, source: "meta_lead_form", receivedAt: event.received_at, raw: new TextEncoder().encode(event.raw_body), metadata: event.headers }, context);
    if (!decoded.ok) throw new Error(decoded.message);
    let ingested = 0;
    for (const reference of decoded.leads) {
      const candidate = await adapter.hydrate(reference, context);
      await ingestCandidate(tenantId, candidate, { webhookEventId: event.id, pageId: reference.pointer.pageId });
      ingested += 1;
    }
    await withTenant({ tenantId, userRole: "system" }, async (transaction) => {
      await transaction`INSERT INTO app.webhook_processing_events (tenant_id,webhook_event_id,status,detail) VALUES (${tenantId},${event.id},${decoded.leads.length ? "completed" : "ignored"},${transaction.json({ leads: ingested })})`;
      await transaction`UPDATE app.meta_connections SET last_healthy_at=clock_timestamp(),updated_at=clock_timestamp() WHERE tenant_id=${tenantId} AND id=${meta.id}`;
    });
    return { ingested };
  } catch (error) {
    await withTenant({ tenantId, userRole: "system" }, (transaction) => transaction`INSERT INTO app.webhook_processing_events (tenant_id,webhook_event_id,status,detail) VALUES (${tenantId},${event.id},'failed',${transaction.json({ error: error instanceof Error ? error.message : "Unknown Meta processing error" })})`);
    throw error;
  }
}

export async function reconcileMetaLeads(tenantId: string, now = new Date(), signal = new AbortController().signal) {
  const meta = await connection(tenantId); const context = { tenantId, connectionId: meta.source_connection_id, signal };
  let found = 0; let inserted = 0; let unchanged = 0;
  try {
    for await (const reference of adapter.reconcile!({ from: new Date(now.getTime() - 2 * 60 * 60_000), to: now }, context)) {
      found += 1; const candidate = await adapter.hydrate(reference, context);
      const result = await ingestCandidate(tenantId, candidate, { reconciliation: true });
      if (result.action === "inserted") inserted += 1; else unchanged += 1;
    }
    const result = { status: "completed", found, inserted, unchanged };
    await withTenant({ tenantId, userRole: "system" }, (transaction) => transaction`UPDATE app.meta_connections SET last_reconciled_at=clock_timestamp(),last_reconciliation_result=${transaction.json(result)},last_healthy_at=clock_timestamp(),updated_at=clock_timestamp() WHERE tenant_id=${tenantId} AND id=${meta.id}`);
    return result;
  } catch (error) {
    const result = { status: "failed", found, inserted, unchanged, error: error instanceof Error ? error.message : "Unknown reconciliation error" };
    await withTenant({ tenantId, userRole: "system" }, (transaction) => transaction`UPDATE app.meta_connections SET last_reconciled_at=clock_timestamp(),last_reconciliation_result=${transaction.json(result)},updated_at=clock_timestamp() WHERE tenant_id=${tenantId} AND id=${meta.id}`);
    throw error;
  }
}

export async function testMetaConnection(tenantId: string, signal = new AbortController().signal) {
  const meta = await connection(tenantId);
  const result = await adapter.healthCheck!({ tenantId, connectionId: meta.source_connection_id, signal });
  if (result.healthy) await withTenant({ tenantId, userRole: "system" }, (transaction) => transaction`UPDATE app.meta_connections SET last_healthy_at=clock_timestamp(),updated_at=clock_timestamp() WHERE tenant_id=${tenantId} AND id=${meta.id}`);
  return result;
}
