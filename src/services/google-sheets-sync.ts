import { createHash } from "node:crypto";
import { withTenant } from "@/db";
import { normalizeEmail, normalizePhone } from "@/domain/normalization";
import { externalIdForSheetRow, googleSheetMappingSchema, parseSheetDate, readGoogleSheet, type GoogleSheetRow } from "@/integrations/google-sheets";
import { ingestLead } from "@/services/lead-intake";

interface ConnectionRow {
  id: string; spreadsheet_id: string; sheet_name: string; header_row: number; mapping: unknown; created_by: string;
  import_after: Date; last_synced_row: number; last_full_check_at: Date | null;
}

export interface GoogleSheetSyncResult {
  rowsSeen: number; inserted: number; repeats: number; rejected: number; unchanged: number; skipped: number;
}

const FULL_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function syncGoogleSheetConnection(tenantId: string, connectionId?: string, signal?: AbortSignal): Promise<GoogleSheetSyncResult> {
  const [connection] = await withTenant({ tenantId, userRole: "system" }, (transaction) => transaction<ConnectionRow[]>`
    SELECT id,spreadsheet_id,sheet_name,header_row,mapping,created_by,import_after,last_synced_row,last_full_check_at
    FROM app.google_sheet_connections
    WHERE tenant_id=${tenantId} AND enabled AND (${connectionId ?? null}::uuid IS NULL OR id=${connectionId ?? null})
    ORDER BY created_at LIMIT 1
  `);
  if (!connection) throw new Error("No enabled Google Sheets connection was found");
  const mapping = googleSheetMappingSchema.parse(connection.mapping);
  const fullCheck = !connection.last_full_check_at || Date.now() - new Date(connection.last_full_check_at).getTime() >= FULL_CHECK_INTERVAL_MS;
  const startRow = fullCheck ? connection.header_row + 1 : Math.max(connection.header_row + 1, connection.last_synced_row + 1);
  const [run] = await withTenant({ tenantId, userRole: "system" }, (transaction) => transaction<{ id: string }[]>`
    INSERT INTO app.google_sheet_sync_runs (tenant_id,google_sheet_connection_id,status)
    VALUES (${tenantId},${connection.id},'running') RETURNING id
  `);
  try {
    const sheet = await readGoogleSheet({ spreadsheetId: connection.spreadsheet_id, sheetName: connection.sheet_name, headerRow: connection.header_row, startRow, signal });
    const result = await persistRows({ tenantId, connection, mapping, rows: sheet.rows });
    const lastRow = sheet.rows.reduce((max, row) => Math.max(max, row.rowNumber), connection.last_synced_row);
    await withTenant({ tenantId, userRole: "system" }, async (transaction) => {
      await transaction`
        UPDATE app.google_sheet_sync_runs SET status='completed',rows_seen=${result.rowsSeen},inserted_rows=${result.inserted},
          repeat_rows=${result.repeats},rejected_rows=${result.rejected},skipped_rows=${result.skipped},unchanged_rows=${result.unchanged},completed_at=clock_timestamp()
        WHERE tenant_id=${tenantId} AND id=${run.id}
      `;
      await transaction`
        UPDATE app.google_sheet_connections SET last_synced_at=clock_timestamp(),last_healthy_at=clock_timestamp(),last_error=NULL,
          last_synced_row=GREATEST(last_synced_row,${lastRow}),last_skipped_rows=${result.skipped},
          last_full_check_at=CASE WHEN ${fullCheck} THEN clock_timestamp() ELSE last_full_check_at END
        WHERE tenant_id=${tenantId} AND id=${connection.id}
      `;
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Sheets sync failed";
    await withTenant({ tenantId, userRole: "system" }, async (transaction) => {
      await transaction`UPDATE app.google_sheet_sync_runs SET status='failed',error=${message},completed_at=clock_timestamp() WHERE tenant_id=${tenantId} AND id=${run.id}`;
      await transaction`UPDATE app.google_sheet_connections SET last_synced_at=clock_timestamp(),last_error=${message} WHERE tenant_id=${tenantId} AND id=${connection.id}`;
    });
    throw error;
  }
}

async function persistRows(args: {
  tenantId: string; connection: ConnectionRow; mapping: ReturnType<typeof googleSheetMappingSchema.parse>; rows: GoogleSheetRow[];
}): Promise<GoogleSheetSyncResult> {
  return withTenant({ tenantId: args.tenantId, userRole: "system" }, async (transaction) => {
    let inserted = 0; let repeats = 0; let rejected = 0; let unchanged = 0; let skipped = 0;
    for (const row of args.rows) {
      const phoneRaw = row.values[args.mapping.phone];
      const emailRaw = row.values[args.mapping.email];
      const phone = phoneRaw ? normalizePhone(phoneRaw).phoneE164 : null;
      const email = normalizeEmail(emailRaw);
      if (!phone && !email) { rejected += 1; continue; }
      const syncTime = new Date();
      const arrivedAt = parseSheetDate(row.values[args.mapping.createdAt], syncTime);
      if (arrivedAt < new Date(args.connection.import_after)) { skipped += 1; continue; }
      const externalId = externalIdForSheetRow({ spreadsheetId: args.connection.spreadsheet_id, sheetName: args.connection.sheet_name, row, mapping: args.mapping });
      const mappedHeaders = new Set(Object.values(args.mapping).filter(Boolean));
      const customFields = Object.fromEntries(Object.entries(row.values).filter(([key]) => !mappedHeaders.has(key)));
      Object.assign(customFields, {
        _googleSheets: {
          spreadsheetId: args.connection.spreadsheet_id, sheetName: args.connection.sheet_name,
          rowNumber: row.rowNumber, rowHash: createHash("sha256").update(JSON.stringify(row.values)).digest("hex"),
        },
      });
      try {
        const result = await ingestLead(transaction, args.tenantId, {
          source: "csv_import", externalId, metaLeadId: row.values[args.mapping.metaLeadId] || null,
          arrivedAt, fullNameRaw: row.values[args.mapping.fullName], phoneRaw, emailRaw,
          city: row.values[args.mapping.city], campaignName: row.values[args.mapping.campaignName], adName: row.values[args.mapping.adName],
          customFields, eventPayload: { transport: "google_sheets", connectionId: args.connection.id, rowNumber: row.rowNumber },
        });
        if (result.action === "inserted") inserted += 1;
        else if (result.action === "unchanged") unchanged += 1;
        else repeats += 1;
      } catch {
        rejected += 1;
      }
    }
    return { rowsSeen: args.rows.length, inserted, repeats, rejected, unchanged, skipped };
  });
}
