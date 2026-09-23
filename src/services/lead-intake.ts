import type postgres from "postgres";
import { normalizeEmail, normalizePhone, titleCaseName } from "@/domain/normalization";
import type { LeadSource } from "@/domain/types";

export interface InboundLead {
  source: LeadSource;
  externalId: string;
  metaLeadId?: string | null;
  arrivedAt: Date;
  fullNameRaw?: string | null;
  phoneRaw?: string | null;
  emailRaw?: string | null;
  city?: string | null;
  campaignName?: string | null;
  campaignId?: string | null;
  adsetName?: string | null;
  adsetId?: string | null;
  adName?: string | null;
  adId?: string | null;
  formId?: string | null;
  formName?: string | null;
  customFields?: Record<string, unknown>;
  eventPayload?: Record<string, unknown>;
}

export type IngestResult = { action: "inserted" | "unchanged" | "repeat_open" | "reactivated"; leadId: string };

async function nextAssignee(transaction: postgres.TransactionSql, tenantId: string): Promise<string | null> {
  await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`assignment:${tenantId}`},0))`;
  const [salesperson] = await transaction<{ id: string }[]>`
    SELECT u.id
    FROM app.users u
    WHERE u.tenant_id=${tenantId} AND u.role='salesperson' AND u.status='active' AND u.available
    ORDER BY (
      SELECT max(l.assigned_at) FROM app.leads l
      WHERE l.tenant_id=u.tenant_id AND l.assigned_to=u.id
    ) ASC NULLS FIRST, u.created_at, u.id
    LIMIT 1
  `;
  if (salesperson) return salesperson.id;
  const [owner] = await transaction<{ id: string }[]>`
    SELECT id FROM app.users
    WHERE tenant_id=${tenantId} AND role='owner' AND status='active'
    ORDER BY created_at,id LIMIT 1
  `;
  return owner?.id ?? null;
}

export async function ingestLead(transaction: postgres.TransactionSql, tenantId: string, input: InboundLead): Promise<IngestResult> {
  const phone = input.phoneRaw ? normalizePhone(input.phoneRaw) : { phoneE164: null };
  const email = normalizeEmail(input.emailRaw);
  if (!phone.phoneE164 && !email) throw new Error("A phone number or email is required");
  const lockIdentity = phone.phoneE164 ?? `email:${email}`;
  await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${lockIdentity}`},0))`;

  const [exact] = await transaction<{ id: string }[]>`
    SELECT id FROM app.leads
    WHERE tenant_id=${tenantId} AND source=${input.source}::app.lead_source AND external_id=${input.externalId}
    LIMIT 1
  `;
  if (exact) return { action: "unchanged", leadId: exact.id };

  const [metaMatch] = input.metaLeadId ? await transaction<{ id: string }[]>`
    SELECT id FROM app.leads WHERE tenant_id=${tenantId} AND meta_lead_id=${input.metaLeadId} LIMIT 1
  ` : [];
  if (metaMatch) {
    await transaction`UPDATE app.leads SET
      meta_lead_id=COALESCE(${input.metaLeadId ?? null},meta_lead_id), form_id=COALESCE(${input.formId ?? null},form_id), form_name=COALESCE(${input.formName ?? null},form_name),
      campaign_id=COALESCE(${input.campaignId ?? null},campaign_id), campaign_name=COALESCE(${input.campaignName ?? null},campaign_name),
      adset_id=COALESCE(${input.adsetId ?? null},adset_id), adset_name=COALESCE(${input.adsetName ?? null},adset_name), ad_id=COALESCE(${input.adId ?? null},ad_id), ad_name=COALESCE(${input.adName ?? null},ad_name),
      custom_fields=custom_fields || ${transaction.json(JSON.parse(JSON.stringify(input.customFields ?? {})))}::jsonb,updated_at=clock_timestamp()
      WHERE tenant_id=${tenantId} AND id=${metaMatch.id}`;
    await transaction`INSERT INTO app.lead_events (tenant_id,lead_id,event_type,actor_type,payload) VALUES (${tenantId},${metaMatch.id},'source_matched','system',${transaction.json({ source: input.source, externalId: input.externalId, metaLeadId: input.metaLeadId, ...input.eventPayload })})`;
    return { action: "unchanged", leadId: metaMatch.id };
  }

  const [existing] = await transaction<{ id: string; stage: string; source: LeadSource; received_at: Date }[]>`
    SELECT id,stage::text,source,received_at FROM app.leads
    WHERE tenant_id=${tenantId}
      AND ((${phone.phoneE164}::text IS NOT NULL AND phone_e164=${phone.phoneE164})
        OR (${email}::text IS NOT NULL AND lower(email)=lower(${email})))
    ORDER BY received_at DESC LIMIT 1 FOR UPDATE
  `;

  const isCrossSourceDuplicate = existing && existing.source !== input.source && Math.abs(existing.received_at.getTime() - input.arrivedAt.getTime()) <= 10 * 60_000;
  if (isCrossSourceDuplicate) {
    await transaction`UPDATE app.leads SET
      meta_lead_id=COALESCE(${input.metaLeadId ?? null},meta_lead_id), form_id=COALESCE(${input.formId ?? null},form_id), form_name=COALESCE(${input.formName ?? null},form_name),
      campaign_id=COALESCE(${input.campaignId ?? null},campaign_id),campaign_name=COALESCE(${input.campaignName ?? null},campaign_name),
      adset_id=COALESCE(${input.adsetId ?? null},adset_id),adset_name=COALESCE(${input.adsetName ?? null},adset_name),ad_id=COALESCE(${input.adId ?? null},ad_id),ad_name=COALESCE(${input.adName ?? null},ad_name),
      custom_fields=custom_fields || ${transaction.json(JSON.parse(JSON.stringify(input.customFields ?? {})))}::jsonb,updated_at=clock_timestamp()
      WHERE tenant_id=${tenantId} AND id=${existing.id}`;
    await transaction`INSERT INTO app.lead_events (tenant_id,lead_id,event_type,actor_type,payload) VALUES (${tenantId},${existing.id},'source_matched','system',${transaction.json({ source: input.source, externalId: input.externalId, metaLeadId: input.metaLeadId, matchedWithinMinutes: 10, ...input.eventPayload })})`;
    return { action: "unchanged", leadId: existing.id };
  }

  const [store] = await transaction<{ id: string }[]>`
    SELECT id FROM app.stores WHERE tenant_id=${tenantId} AND active AND is_default ORDER BY created_at LIMIT 1
  `;
  if (!store) throw new Error("Configure a default store before importing leads");
  const [policy] = await transaction<{ id: string; first_touch_target_minutes: number }[]>`
    SELECT id,first_touch_target_minutes FROM app.sla_policies
    WHERE tenant_id=${tenantId} AND applies_to='domestic' AND effective_from<=clock_timestamp()
    ORDER BY effective_from DESC,version DESC LIMIT 1
  `;
  if (!policy) throw new Error("Configure the first-response policy before importing leads");
  const assigneeId = await nextAssignee(transaction, tenantId);
  if (!assigneeId) throw new Error("Create an active owner before importing leads");
  const dueAt = (await transaction<{ due_at: Date }[]>`SELECT app.add_store_business_minutes(${tenantId},${store.id},${input.arrivedAt},${policy.first_touch_target_minutes}) AS due_at`)[0].due_at;

  if (existing && existing.stage === "dormant") {
    await transaction`
      UPDATE app.lead_followups SET status='cancelled'
      WHERE tenant_id=${tenantId} AND lead_id=${existing.id} AND status='pending'
    `;
    await transaction`
      UPDATE app.leads SET
        source=${input.source}::app.lead_source, external_id=${input.externalId}, meta_lead_id=COALESCE(${input.metaLeadId ?? null},meta_lead_id),
        full_name=COALESCE(${titleCaseName(input.fullNameRaw ?? "") || null},full_name), full_name_raw=COALESCE(${input.fullNameRaw ?? null},full_name_raw),
        email=COALESCE(${email},email), city=COALESCE(${input.city ?? null},city), campaign_id=COALESCE(${input.campaignId ?? null},campaign_id), campaign_name=COALESCE(${input.campaignName ?? null},campaign_name),
        adset_id=COALESCE(${input.adsetId ?? null},adset_id), adset_name=COALESCE(${input.adsetName ?? null},adset_name), ad_id=COALESCE(${input.adId ?? null},ad_id), ad_name=COALESCE(${input.adName ?? null},ad_name),
        form_id=COALESCE(${input.formId ?? null},form_id), form_name=COALESCE(${input.formName ?? null},form_name), custom_fields=custom_fields || ${transaction.json(JSON.parse(JSON.stringify(input.customFields ?? {})))}::jsonb,
        stage='new', conversation_state='waiting_on_us', received_at=${input.arrivedAt}, assigned_to=${assigneeId}, assigned_at=clock_timestamp(), store_id=${store.id},
        first_touch_at=NULL, first_contacted_at=NULL, first_response_minutes=NULL, first_connect_at=NULL,
        sla_policy_version_id=${policy.id}, sla_due_at=${dueAt}, sla_breached=false, sla_breach_minutes=NULL,
        attempt_count=0, last_attempt_at=NULL, next_action_at=NULL, closed_at=NULL, closed_by=NULL, outcome_reason=NULL, order_value=NULL,
        enquiry_count=enquiry_count+1
      WHERE tenant_id=${tenantId} AND id=${existing.id}
    `;
    await transaction`INSERT INTO app.lead_events (tenant_id,lead_id,event_type,actor_type,payload) VALUES (${tenantId},${existing.id},'repeat_enquiry_reactivated','system',${transaction.json({ source: input.source, externalId: input.externalId, arrivedAt: input.arrivedAt.toISOString(), assignedTo: assigneeId, ...input.eventPayload })})`;
    return { action: "reactivated", leadId: existing.id };
  }

  if (existing && !["won", "dead", "bad"].includes(existing.stage)) {
    await transaction`UPDATE app.leads SET enquiry_count=enquiry_count+1 WHERE tenant_id=${tenantId} AND id=${existing.id}`;
    await transaction`INSERT INTO app.lead_events (tenant_id,lead_id,event_type,actor_type,payload) VALUES (${tenantId},${existing.id},'repeat_enquiry','system',${transaction.json({ source: input.source, externalId: input.externalId, arrivedAt: input.arrivedAt.toISOString(), ...input.eventPayload })})`;
    return { action: "repeat_open", leadId: existing.id };
  }

  if (existing) await transaction`INSERT INTO app.lead_events (tenant_id,lead_id,event_type,actor_type,payload) VALUES (${tenantId},${existing.id},'repeat_enquiry_new_lead','system',${transaction.json({ source: input.source, externalId: input.externalId, arrivedAt: input.arrivedAt.toISOString(), ...input.eventPayload })})`;

  const leadId = crypto.randomUUID();
  await transaction`
    INSERT INTO app.leads (
      id,tenant_id,source,external_id,meta_lead_id,full_name,full_name_raw,phone_e164,phone_raw,email,city,
      form_id,form_name,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,custom_fields,assigned_to,assigned_at,store_id,lead_created_at,received_at,sla_policy_version_id,sla_due_at
    ) VALUES (
      ${leadId},${tenantId},${input.source}::app.lead_source,${input.externalId},${input.metaLeadId ?? null},
      ${titleCaseName(input.fullNameRaw ?? "") || null},${input.fullNameRaw ?? null},${phone.phoneE164},${input.phoneRaw ?? null},${email},${input.city ?? null},
      ${input.formId ?? null},${input.formName ?? null},${input.campaignId ?? null},${input.campaignName ?? null},${input.adsetId ?? null},${input.adsetName ?? null},${input.adId ?? null},${input.adName ?? null},
      ${transaction.json(JSON.parse(JSON.stringify(input.customFields ?? {})))},${assigneeId},clock_timestamp(),${store.id},${input.arrivedAt},${input.arrivedAt},${policy.id},${dueAt}
    )
  `;
  await transaction`INSERT INTO app.lead_events (tenant_id,lead_id,event_type,actor_type,payload) VALUES (${tenantId},${leadId},'lead_received','system',${transaction.json({ source: input.source, externalId: input.externalId, arrivedAt: input.arrivedAt.toISOString(), assignedTo: assigneeId, ...input.eventPayload })})`;
  return { action: "inserted", leadId };
}
