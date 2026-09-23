import { NextResponse } from "next/server";
import { adapterFor } from "@/lead-sources/registry";
import { readSession } from "@/lib/auth";
import { createHash } from "node:crypto";
import { withTenant } from "@/db";
import { normalizeEmail, normalizePhone, titleCaseName } from "@/domain/normalization";
import { computeSlaDueAt, type DailyHours, type Holiday } from "@/domain/sla";
import { env } from "@/lib/env";

export async function POST(request: Request) {
  const user = await readSession();
  if (!user && env().DEMO_MODE === "false") return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user && user.role !== "admin" && user.role !== "owner") return NextResponse.json({ error: "Admin or owner access required" }, { status: 403 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a CSV file" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "CSV must be smaller than 10 MB" }, { status: 413 });
  const raw = new Uint8Array(await file.arrayBuffer());
  const checksum = createHash("sha256").update(raw).digest("hex");
  const adapter = adapterFor("csv_import");
  const result = await adapter.decode({ id: checksum, tenantId: user?.tenantId ?? env().DEFAULT_TENANT_ID, source: "csv_import", receivedAt: new Date(), raw, metadata: { fileName: file.name } }, { tenantId: user?.tenantId ?? env().DEFAULT_TENANT_ID, connectionId: "44444444-4444-4444-8444-444444444442", signal: request.signal });
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 422 });
  const hydrated = await Promise.all(result.leads.slice(0, 5000).map((reference) => adapter.hydrate(reference, { tenantId: user?.tenantId ?? "11111111-1111-4111-8111-111111111111", connectionId: "44444444-4444-4444-8444-444444444442", signal: request.signal })));
  const valid = hydrated.filter((lead) => lead.person.phoneRaw || lead.person.emailRaw).length;
  if (env().DEMO_MODE === "false" && user) {
    const persisted = await withTenant(user, async (transaction) => {
      const [store] = await transaction<{ id: string }[]>`SELECT id FROM app.stores WHERE tenant_id = ${user.tenantId} AND active AND is_default LIMIT 1`;
      if (!store) throw new Error("Configure a default store before importing leads");
      const hoursRows = await transaction<{ weekday: number; opens_at: string; closes_at: string; enabled: boolean }[]>`
        SELECT weekday, opens_at::text, closes_at::text, enabled FROM app.business_hours WHERE tenant_id = ${user.tenantId} AND store_id = ${store.id}
      `;
      const holidayRows = await transaction<{ holiday_date: string; closed: boolean; opens_at: string | null; closes_at: string | null }[]>`
        SELECT holiday_date::text, closed, opens_at::text, closes_at::text FROM app.store_holidays WHERE tenant_id = ${user.tenantId} AND store_id = ${store.id}
      `;
      const policies = await transaction<{ id: string; applies_to: "domestic" | "international"; first_touch_target_minutes: number }[]>`
        SELECT DISTINCT ON (applies_to) id, applies_to, first_touch_target_minutes
        FROM app.sla_policies
        WHERE tenant_id = ${user.tenantId} AND effective_from <= clock_timestamp()
        ORDER BY applies_to, effective_from DESC, version DESC
      `;
      const [assignee] = await transaction<{ id: string }[]>`
        SELECT u.id
        FROM app.users u
        LEFT JOIN app.leads l ON l.tenant_id = u.tenant_id AND l.assigned_to = u.id AND l.conversation_state = 'waiting_on_us'
        WHERE u.tenant_id = ${user.tenantId} AND u.store_id = ${store.id} AND u.role = 'salesperson' AND u.status = 'active' AND u.available
        GROUP BY u.id ORDER BY count(l.id), u.id LIMIT 1
      `;
      const [internationalHandler] = await transaction<{ id: string }[]>`
        SELECT u.id FROM app.assignment_rules r
        JOIN app.users u ON u.tenant_id = r.tenant_id AND u.id = r.action ->> 'userId'
        WHERE r.tenant_id = ${user.tenantId} AND r.active AND r.conditions ->> 'isInternational' = 'true' AND u.status = 'active'
        ORDER BY r.priority LIMIT 1
      `;
      const [owner] = await transaction<{ id: string }[]>`SELECT id FROM app.users WHERE tenant_id = ${user.tenantId} AND role = 'owner' AND status = 'active' ORDER BY created_at LIMIT 1`;
      const [importRecord] = await transaction<{ id: string }[]>`
        INSERT INTO app.imports (tenant_id, file_name, checksum, status, total_rows, created_by)
        VALUES (${user.tenantId}, ${file.name}, ${checksum}, 'processing', ${hydrated.length}, ${user.id})
        RETURNING id
      `;
      const hours: DailyHours[] = hoursRows.map((row) => ({ weekday: row.weekday, opensAt: row.opens_at.slice(0, 5), closesAt: row.closes_at.slice(0, 5), enabled: row.enabled }));
      const holidays: Holiday[] = holidayRows.map((row) => ({ date: row.holiday_date, closed: row.closed, opensAt: row.opens_at?.slice(0, 5), closesAt: row.closes_at?.slice(0, 5) }));
      let inserted = 0; let rejected = 0; let repeats = 0;
      for (let index = 0; index < hydrated.length; index += 1) {
        const candidate = hydrated[index];
        const phone = candidate.person.phoneRaw ? normalizePhone(candidate.person.phoneRaw) : { phoneE164: null, isInternational: false };
        const email = normalizeEmail(candidate.person.emailRaw);
        const rowNumber = Number(result.leads[index].pointer.rowNumber ?? index + 2);
        if (!phone.phoneE164 && !email) {
          rejected += 1;
          await transaction`
            INSERT INTO app.import_rows (tenant_id, import_id, row_number, raw, status, error)
            VALUES (${user.tenantId}, ${importRecord.id}, ${rowNumber}, ${JSON.stringify(candidate.rawPayload)}::jsonb, 'rejected', 'A valid phone number or email is required')
          `;
          continue;
        }
        const [existing] = await transaction<{ id: string; external_id: string }[]>`
          SELECT id, external_id FROM app.leads
          WHERE tenant_id = ${user.tenantId}
            AND ((source = 'csv_import' AND external_id = ${candidate.externalId}) OR (${phone.phoneE164}::text IS NOT NULL AND phone_e164 = ${phone.phoneE164}))
          ORDER BY (external_id = ${candidate.externalId}) DESC LIMIT 1
        `;
        if (existing) {
          if (existing.external_id === candidate.externalId) {
            rejected += 1;
            await transaction`
              INSERT INTO app.import_rows (tenant_id, import_id, row_number, raw, status, lead_id, error)
              VALUES (${user.tenantId}, ${importRecord.id}, ${rowNumber}, ${JSON.stringify(candidate.rawPayload)}::jsonb, 'rejected', ${existing.id}, 'This source row was already imported')
            `;
          } else {
            repeats += 1;
            await transaction`UPDATE app.leads SET enquiry_count = enquiry_count + 1 WHERE tenant_id = ${user.tenantId} AND id = ${existing.id}`;
            await transaction`
              INSERT INTO app.lead_events (tenant_id, lead_id, event_type, actor_id, actor_type, payload)
              VALUES (${user.tenantId}, ${existing.id}, 'repeat_enquiry', ${user.id}, 'user', ${JSON.stringify({ source: "csv_import", externalId: candidate.externalId, sourceCreatedAt: candidate.sourceCreatedAt })}::jsonb)
            `;
            await transaction`
              INSERT INTO app.import_rows (tenant_id, import_id, row_number, raw, normalized, status, lead_id)
              VALUES (${user.tenantId}, ${importRecord.id}, ${rowNumber}, ${JSON.stringify(candidate.rawPayload)}::jsonb, ${JSON.stringify({ phoneE164: phone.phoneE164, email })}::jsonb, 'repeat_enquiry', ${existing.id})
            `;
          }
          continue;
        }
        const policy = policies.find((item) => item.applies_to === (phone.isInternational ? "international" : "domestic"));
        if (!policy) throw new Error(`No active ${phone.isInternational ? "international" : "domestic"} SLA policy is configured`);
        const dueAt = computeSlaDueAt({ receivedAt: candidate.sourceCreatedAt, isInternational: phone.isInternational, targetMinutes: policy.first_touch_target_minutes, hours, holidays });
        const leadId = crypto.randomUUID();
        const assignedUserId = phone.isInternational ? internationalHandler?.id ?? owner?.id ?? null : assignee?.id ?? null;
        await transaction`
          INSERT INTO app.leads (
            id, tenant_id, source, external_id, campaign_id, campaign_name, ad_id, ad_name,
            full_name, full_name_raw, phone_e164, phone_raw, email, city, is_international,
            custom_fields, assigned_to, assigned_at, store_id, lead_created_at, received_at,
            sla_policy_version_id, sla_due_at
          ) VALUES (
            ${leadId}, ${user.tenantId}, 'csv_import', ${candidate.externalId}, ${candidate.attribution?.campaignId ?? null}, ${candidate.attribution?.campaignName ?? null},
            ${candidate.attribution?.adId ?? null}, ${candidate.attribution?.adName ?? null}, ${titleCaseName(candidate.person.fullNameRaw)}, ${candidate.person.fullNameRaw ?? null},
            ${phone.phoneE164}, ${candidate.person.phoneRaw ?? null}, ${email}, ${candidate.person.cityRaw ?? null}, ${phone.isInternational},
            ${JSON.stringify(candidate.customFields)}::jsonb, ${assignedUserId}, ${assignedUserId ? new Date() : null}, ${store.id}, ${candidate.sourceCreatedAt}, clock_timestamp(),
            ${policy.id}, ${dueAt}
          )
        `;
        await transaction`
          INSERT INTO app.lead_events (tenant_id, lead_id, event_type, actor_id, actor_type, payload)
          VALUES (${user.tenantId}, ${leadId}, 'lead_received', ${user.id}, 'user', ${JSON.stringify({ source: "csv_import", importId: importRecord.id, assignedTo: assignedUserId })}::jsonb)
        `;
        if (assignedUserId) await transaction`
          INSERT INTO app.notifications (tenant_id, lead_id, recipient_user_id, channel, template, deduplication_key, payload)
          VALUES (${user.tenantId}, ${leadId}, ${assignedUserId}, 'whatsapp', 'new_lead', ${`new-lead:${leadId}`}, ${JSON.stringify({ name: titleCaseName(candidate.person.fullNameRaw), city: candidate.person.cityRaw, adName: candidate.attribution?.adName, international: phone.isInternational })}::jsonb)
          ON CONFLICT (tenant_id, deduplication_key) DO NOTHING
        `;
        await transaction`
          INSERT INTO app.import_rows (tenant_id, import_id, row_number, raw, normalized, status, lead_id)
          VALUES (${user.tenantId}, ${importRecord.id}, ${rowNumber}, ${JSON.stringify(candidate.rawPayload)}::jsonb, ${JSON.stringify({ phoneE164: phone.phoneE164, email })}::jsonb, 'inserted', ${leadId})
        `;
        inserted += 1;
      }
      await transaction`
        UPDATE app.imports SET status = 'completed', inserted_rows = ${inserted}, rejected_rows = ${rejected}, completed_at = clock_timestamp()
        WHERE tenant_id = ${user.tenantId} AND id = ${importRecord.id}
      `;
      return { importId: importRecord.id, inserted, rejected, repeats };
    });
    return NextResponse.json({ rows: hydrated.length, valid, ...persisted });
  }
  return NextResponse.json({ rows: hydrated.length, valid, rejected: hydrated.length - valid });
}
