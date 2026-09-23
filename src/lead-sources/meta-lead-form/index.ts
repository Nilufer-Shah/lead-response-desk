import { createHmac, timingSafeEqual } from "node:crypto";
import { withTenant } from "@/db";
import { env } from "@/lib/env";
import type { AdapterContext, CanonicalLeadCandidate, DecodeResult, LeadSourceAdapter, PersistedIngress, ReconciliationWindow, SourceLeadReference } from "../types";

export interface MetaPointer extends Record<string, unknown> { leadgenId: string; pageId: string; formId: string; adId?: string }
export interface MetaField { name: string; values?: string[] }
export interface MetaGraphLead extends Record<string, unknown> {
  id: string; created_time: string; field_data?: MetaField[]; ad_id?: string; ad_name?: string;
  adset_id?: string; adset_name?: string; campaign_id?: string; campaign_name?: string; form_id?: string;
}

const graphFields = "id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id";
const defaultFieldMap: Record<string, string> = { full_name: "fullNameRaw", name: "fullNameRaw", phone_number: "phoneRaw", phone: "phoneRaw", email: "emailRaw", city: "cityRaw" };

export function verifyMetaSignature(rawBody: Uint8Array, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=") || !secret) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"), "utf8");
  const supplied = Buffer.from(header.slice(7), "utf8");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function dateFromMeta(value: unknown, fallback: Date): Date {
  if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) {
    const date = new Date(Number(value) * 1_000); if (!Number.isNaN(date.getTime())) return date;
  }
  if (typeof value === "string") { const date = new Date(value); if (!Number.isNaN(date.getTime())) return date; }
  return fallback;
}

export function decodeMetaPayload(rawBody: Uint8Array, receivedAt = new Date()): DecodeResult<MetaPointer> {
  try {
    const body = JSON.parse(new TextDecoder().decode(rawBody)) as { entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: Record<string, unknown> }> }> };
    const leads: SourceLeadReference<MetaPointer>[] = [];
    for (const entry of body.entry ?? []) for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;
      const value = change.value ?? {}; const leadgenId = String(value.leadgen_id ?? "");
      if (!leadgenId) continue;
      leads.push({ externalId: leadgenId, sourceCreatedAt: dateFromMeta(value.created_time, receivedAt), pointer: { leadgenId, pageId: String(value.page_id ?? entry.id ?? ""), formId: String(value.form_id ?? ""), adId: value.ad_id ? String(value.ad_id) : undefined } });
    }
    return { ok: true, leads };
  } catch { return { ok: true, leads: [] }; }
}

export function mapMetaFields(lead: MetaGraphLead, configured: Record<string, string> = {}): CanonicalLeadCandidate {
  const person: { fullNameRaw?: string; phoneRaw?: string; emailRaw?: string; cityRaw?: string } = {};
  const customFields: Record<string, unknown> = {};
  for (const field of lead.field_data ?? []) {
    const value = field.values?.[0]; customFields[field.name] = field.values ?? [];
    const target = configured[field.name] ?? defaultFieldMap[field.name];
    if (target && value) person[target as keyof typeof person] = value;
  }
  return { source: "meta_lead_form", externalId: lead.id, sourceCreatedAt: dateFromMeta(lead.created_time, new Date()), form: lead.form_id ? { id: lead.form_id } : undefined, attribution: { campaignId: lead.campaign_id, campaignName: lead.campaign_name, adsetId: lead.adset_id, adsetName: lead.adset_name, adId: lead.ad_id, adName: lead.ad_name }, person, customFields, rawPayload: lead };
}

export async function metaGraphRequest<T>(path: string, options: { token: string; graphVersion: string; signal?: AbortSignal; fetchImpl?: typeof fetch }): Promise<T> {
  if (!options.token) throw new Error("META_SYSTEM_USER_TOKEN is not configured");
  const url = path.startsWith("https://") ? new URL(path) : new URL(`https://graph.facebook.com/${options.graphVersion}/${path}`);
  url.searchParams.delete("access_token");
  const response = await (options.fetchImpl ?? fetch)(url, { signal: options.signal, headers: { authorization: `Bearer ${options.token}` } });
  if (!response.ok) throw new Error(`Meta Graph API ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json() as Promise<T>;
}

async function graphJson<T>(path: string, signal: AbortSignal): Promise<T> {
  return metaGraphRequest<T>(path, { token: env().META_SYSTEM_USER_TOKEN ?? "", graphVersion: env().META_GRAPH_VERSION, signal });
}

async function configuredMap(context: AdapterContext, formId: string): Promise<Record<string, string>> {
  return withTenant({ tenantId: context.tenantId, userRole: "system" }, async (transaction) => {
    const rows = await transaction<{ source_field: string; target_field: string }[]>`
      SELECT m.source_field,m.target_field FROM app.form_field_map m JOIN app.source_forms f ON f.tenant_id=m.tenant_id AND f.id=m.source_form_id
      WHERE m.tenant_id=${context.tenantId} AND f.source_connection_id=${context.connectionId} AND f.external_id=${formId}`;
    return Object.fromEntries(rows.map((row) => [row.source_field, row.target_field]));
  });
}

export class MetaLeadFormAdapter implements LeadSourceAdapter<MetaPointer> {
  readonly source = "meta_lead_form" as const;
  async decode(ingress: PersistedIngress, context: AdapterContext): Promise<DecodeResult<MetaPointer>> { void context; return decodeMetaPayload(ingress.raw, ingress.receivedAt); }
  async hydrate(reference: SourceLeadReference<MetaPointer>, context: AdapterContext): Promise<CanonicalLeadCandidate> {
    const lead = await graphJson<MetaGraphLead>(`${encodeURIComponent(reference.pointer.leadgenId)}?fields=${encodeURIComponent(graphFields)}`, context.signal);
    return mapMetaFields(lead, await configuredMap(context, String(lead.form_id ?? reference.pointer.formId)));
  }
  async *reconcile(window: ReconciliationWindow, context: AdapterContext): AsyncIterable<SourceLeadReference<MetaPointer>> {
    const forms = await withTenant({ tenantId: context.tenantId, userRole: "system" }, (transaction) => transaction<{ external_id: string }[]>`SELECT external_id FROM app.source_forms WHERE tenant_id=${context.tenantId} AND source_connection_id=${context.connectionId} AND active ORDER BY external_id`);
    for (const form of forms) {
      let path: string | undefined = `${encodeURIComponent(form.external_id)}/leads?fields=${encodeURIComponent(graphFields)}&since=${Math.floor(window.from.getTime()/1000)}&until=${Math.floor(window.to.getTime()/1000)}&limit=100`;
      while (path) {
        const page: { data?: MetaGraphLead[]; paging?: { next?: string } } = await graphJson(path, context.signal);
        for (const lead of page.data ?? []) yield { externalId: lead.id, sourceCreatedAt: dateFromMeta(lead.created_time, window.to), pointer: { leadgenId: lead.id, pageId: "", formId: String(lead.form_id ?? form.external_id), adId: lead.ad_id } };
        path = page.paging?.next;
      }
    }
  }
  async healthCheck(context: AdapterContext) { const result = await graphJson<{ id: string }>("me?fields=id", context.signal); return { healthy: Boolean(result.id), checkedAt: new Date(), detail: result.id }; }
}
