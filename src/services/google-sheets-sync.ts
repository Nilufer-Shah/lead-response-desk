import { createHash } from "node:crypto";
import { withTenant } from "@/db";
import { normalizeEmail, normalizePhone, titleCaseName } from "@/domain/normalization";
import { computeSlaDueAt, type DailyHours, type Holiday } from "@/domain/sla";
import { externalIdForSheetRow, googleSheetMappingSchema, parseSheetDate, readGoogleSheet, type GoogleSheetRow } from "@/integrations/google-sheets";

interface ConnectionRow {
  id: string; spreadsheet_id: string; sheet_name: string; header_row: number;
  mapping: unknown; created_by: string;
}

export interface GoogleSheetSyncResult {
  rowsSeen: number; inserted: number; repeats: number; rejected: number; unchanged: number;
}

export async function syncGoogleSheetConnection(tenantId: string, connectionId?: string, signal?: AbortSignal): Promise<GoogleSheetSyncResult> {
  const [connection] = await withTenant({ tenantId, userRole: "system" }, (transaction) => transaction<ConnectionRow[]>`
    SELECT id, spreadsheet_id, sheet_name, header_row, mapping, created_by
    FROM app.google_sheet_connections
    WHERE tenant_id = ${tenantId} AND enabled AND (${connectionId ?? null}::uuid IS NULL OR id = ${connectionId ?? null})
    ORDER BY created_at LIMIT 1
  `);
  if (!connection) throw new Error("No enabled Google Sheets connection was found");
  const mapping = googleSheetMappingSchema.parse(connection.mapping);
  const [run] = await withTenant({ tenantId, userRole: "system" }, (transaction) => transaction<{ id: string }[]>`
    INSERT INTO app.google_sheet_sync_runs (tenant_id, google_sheet_connection_id, status)
    VALUES (${tenantId}, ${connection.id}, 'running') RETURNING id
  `);
  try {
    const sheet = await readGoogleSheet({ spreadsheetId: connection.spreadsheet_id, sheetName: connection.sheet_name, headerRow: connection.header_row, signal });
    const result = await persistRows({ tenantId, connection, mapping, rows: sheet.rows });
    await withTenant({ tenantId, userRole: "system" }, async (transaction) => {
      await transaction`
        UPDATE app.google_sheet_sync_runs SET status = 'completed', rows_seen = ${result.rowsSeen}, inserted_rows = ${result.inserted},
          repeat_rows = ${result.repeats}, rejected_rows = ${result.rejected}, completed_at = clock_timestamp()
        WHERE tenant_id = ${tenantId} AND id = ${run.id}
      `;
      await transaction`
        UPDATE app.google_sheet_connections SET last_synced_at = clock_timestamp(), last_healthy_at = clock_timestamp(), last_error = NULL
        WHERE tenant_id = ${tenantId} AND id = ${connection.id}
      `;
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Sheets sync failed";
    await withTenant({ tenantId, userRole: "system" }, async (transaction) => {
      await transaction`UPDATE app.google_sheet_sync_runs SET status = 'failed', error = ${message}, completed_at = clock_timestamp() WHERE tenant_id = ${tenantId} AND id = ${run.id}`;
      await transaction`UPDATE app.google_sheet_connections SET last_synced_at = clock_timestamp(), last_error = ${message} WHERE tenant_id = ${tenantId} AND id = ${connection.id}`;
    });
    throw error;
  }
}

async function persistRows(args: { tenantId: string; connection: ConnectionRow; mapping: ReturnType<typeof googleSheetMappingSchema.parse>; rows: GoogleSheetRow[] }): Promise<GoogleSheetSyncResult> {
  return withTenant({ tenantId: args.tenantId, userRole: "system" }, async (transaction) => {
    const [store] = await transaction<{ id: string }[]>`SELECT id FROM app.stores WHERE tenant_id = ${args.tenantId} AND active AND is_default LIMIT 1`;
    if (!store) throw new Error("Configure a default store before syncing Google Sheets");
    const hoursRows = await transaction<{ weekday: number; opens_at: string; closes_at: string; enabled: boolean }[]>`SELECT weekday, opens_at::text, closes_at::text, enabled FROM app.business_hours WHERE tenant_id = ${args.tenantId} AND store_id = ${store.id}`;
    const holidayRows = await transaction<{ holiday_date: string; closed: boolean; opens_at: string | null; closes_at: string | null }[]>`SELECT holiday_date::text, closed, opens_at::text, closes_at::text FROM app.store_holidays WHERE tenant_id = ${args.tenantId} AND store_id = ${store.id}`;
    const policies = await transaction<{ id: string; applies_to: "domestic" | "international"; first_touch_target_minutes: number }[]>`
      SELECT DISTINCT ON (applies_to) id, applies_to, first_touch_target_minutes FROM app.sla_policies
      WHERE tenant_id = ${args.tenantId} AND effective_from <= clock_timestamp() ORDER BY applies_to, effective_from DESC, version DESC
    `;
    const salespeople = await transaction<{ id: string }[]>`
      SELECT u.id FROM app.users u LEFT JOIN app.leads l ON l.tenant_id = u.tenant_id AND l.assigned_to = u.id AND l.conversation_state = 'waiting_on_us'
      WHERE u.tenant_id = ${args.tenantId} AND u.store_id = ${store.id} AND u.role = 'salesperson' AND u.status = 'active' AND u.available
      GROUP BY u.id ORDER BY count(l.id), u.id
    `;
    const [owner] = await transaction<{ id: string }[]>`SELECT id FROM app.users WHERE tenant_id = ${args.tenantId} AND role = 'owner' AND status = 'active' ORDER BY created_at LIMIT 1`;
    const [internationalHandler] = await transaction<{ id: string }[]>`
      SELECT u.id FROM app.assignment_rules r JOIN app.users u ON u.tenant_id = r.tenant_id AND u.id = r.action ->> 'userId'
      WHERE r.tenant_id = ${args.tenantId} AND r.active AND r.conditions ->> 'isInternational' = 'true' AND u.status = 'active' ORDER BY r.priority LIMIT 1
    `;
    const hours: DailyHours[] = hoursRows.map((row) => ({ weekday: row.weekday, opensAt: row.opens_at.slice(0, 5), closesAt: row.closes_at.slice(0, 5), enabled: row.enabled }));
    const holidays: Holiday[] = holidayRows.map((row) => ({ date: row.holiday_date, closed: row.closed, opensAt: row.opens_at?.slice(0, 5), closesAt: row.closes_at?.slice(0, 5) }));
    let inserted = 0; let repeats = 0; let rejected = 0; let unchanged = 0;
    for (const row of args.rows) {
      const phoneRaw = row.values[args.mapping.phone];
      const emailRaw = row.values[args.mapping.email];
      const phone = phoneRaw ? normalizePhone(phoneRaw) : { phoneE164: null, isInternational: false };
      const email = normalizeEmail(emailRaw);
      if (!phone.phoneE164 && !email) { rejected += 1; continue; }
      const externalId = externalIdForSheetRow({ spreadsheetId: args.connection.spreadsheet_id, sheetName: args.connection.sheet_name, row, mapping: args.mapping });
      const [exact] = await transaction<{ id: string }[]>`SELECT id FROM app.leads WHERE tenant_id = ${args.tenantId} AND source = 'csv_import' AND external_id = ${externalId} LIMIT 1`;
      if (exact) { unchanged += 1; continue; }
      const [existing] = phone.phoneE164 ? await transaction<{ id: string }[]>`SELECT id FROM app.leads WHERE tenant_id = ${args.tenantId} AND phone_e164 = ${phone.phoneE164} ORDER BY received_at DESC LIMIT 1` : [];
      if (existing) {
        repeats += 1;
        await transaction`UPDATE app.leads SET enquiry_count = enquiry_count + 1 WHERE tenant_id = ${args.tenantId} AND id = ${existing.id}`;
        await transaction`INSERT INTO app.lead_events (tenant_id, lead_id, event_type, actor_id, actor_type, payload) VALUES (${args.tenantId}, ${existing.id}, 'repeat_enquiry', ${args.connection.created_by}, 'system', ${transaction.json({ source: "csv_import", transport: "google_sheets", externalId, rowNumber: row.rowNumber })})`;
        continue;
      }
      const receivedAt = new Date();
      const sourceCreatedAt = parseSheetDate(row.values[args.mapping.createdAt], receivedAt);
      const policy = policies.find((item) => item.applies_to === (phone.isInternational ? "international" : "domestic"));
      if (!policy) throw new Error(`No active ${phone.isInternational ? "international" : "domestic"} SLA policy is configured`);
      const assigneeId = phone.isInternational ? internationalHandler?.id ?? owner?.id ?? null : salespeople[inserted % Math.max(salespeople.length, 1)]?.id ?? null;
      const dueAt = computeSlaDueAt({ receivedAt: sourceCreatedAt, isInternational: phone.isInternational, targetMinutes: policy.first_touch_target_minutes, hours, holidays });
      const fullNameRaw = row.values[args.mapping.fullName];
      const leadId = crypto.randomUUID();
      const mappedHeaders = new Set(Object.values(args.mapping).filter(Boolean));
      const customFields = Object.fromEntries(Object.entries(row.values).filter(([key]) => !mappedHeaders.has(key)));
      Object.assign(customFields, { _googleSheets: { spreadsheetId: args.connection.spreadsheet_id, sheetName: args.connection.sheet_name, rowNumber: row.rowNumber, rowHash: createHash("sha256").update(JSON.stringify(row.values)).digest("hex") } });
      await transaction`
        INSERT INTO app.leads (id, tenant_id, source, external_id, full_name, full_name_raw, phone_e164, phone_raw, email, city, is_international,
          campaign_name, ad_name, custom_fields, assigned_to, assigned_at, store_id, lead_created_at, received_at, sla_policy_version_id, sla_due_at)
        VALUES (${leadId}, ${args.tenantId}, 'csv_import', ${externalId}, ${titleCaseName(fullNameRaw)}, ${fullNameRaw || null}, ${phone.phoneE164}, ${phoneRaw || null}, ${email},
          ${row.values[args.mapping.city] || null}, ${phone.isInternational}, ${row.values[args.mapping.campaignName] || null}, ${row.values[args.mapping.adName] || null},
          ${transaction.json(customFields)}, ${assigneeId}, ${assigneeId ? receivedAt : null}, ${store.id}, ${sourceCreatedAt}, ${receivedAt}, ${policy.id}, ${dueAt})
      `;
      await transaction`INSERT INTO app.lead_events (tenant_id, lead_id, event_type, actor_id, actor_type, payload) VALUES (${args.tenantId}, ${leadId}, 'lead_received', ${args.connection.created_by}, 'system', ${transaction.json({ source: "csv_import", transport: "google_sheets", connectionId: args.connection.id, rowNumber: row.rowNumber, assignedTo: assigneeId })})`;
      if (assigneeId) await transaction`
        INSERT INTO app.notifications (tenant_id, lead_id, recipient_user_id, channel, template, deduplication_key, payload)
        VALUES (${args.tenantId}, ${leadId}, ${assigneeId}, 'whatsapp', 'new_lead', ${`new-lead:${leadId}`}, ${transaction.json({ name: titleCaseName(fullNameRaw), city: row.values[args.mapping.city], international: phone.isInternational })})
        ON CONFLICT (tenant_id, deduplication_key) DO NOTHING
      `;
      inserted += 1;
    }
    return { rowsSeen: args.rows.length, inserted, repeats, rejected, unchanged };
  });
}
