import { NextResponse } from "next/server";
import { withTenant } from "@/db";
import { extractSpreadsheetId, googleCredentialsConfigured, googleSheetConnectionInputSchema } from "@/integrations/google-sheets";
import { readSession } from "@/lib/auth";
import { env } from "@/lib/env";

function authorize(role?: string) { return role === "owner" || role === "admin"; }

export async function GET() {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!authorize(user.role)) return NextResponse.json({ error: "Owner or admin access required" }, { status: 403 });
  if (env().DEMO_MODE === "true") return NextResponse.json({ demo: true, credentialsConfigured: googleCredentialsConfigured(), serviceAccountEmail: env().GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null, enabledByEnvironment: env().GOOGLE_SHEETS_ENABLED === "true", connection: null, runs: [] });
  const result = await withTenant(user, async (transaction) => {
    const [connection] = await transaction<{
      id: string; spreadsheet_id: string; sheet_name: string; header_row: number; mapping: unknown; enabled: boolean;
      last_synced_at: string | null; last_healthy_at: string | null; last_error: string | null;
    }[]>`SELECT id, spreadsheet_id, sheet_name, header_row, mapping, enabled, last_synced_at::text, last_healthy_at::text, last_error FROM app.google_sheet_connections WHERE tenant_id = ${user.tenantId} ORDER BY created_at LIMIT 1`;
    const runs = connection ? await transaction<{
      id: string; status: string; rows_seen: number; inserted_rows: number; repeat_rows: number; rejected_rows: number; error: string | null; started_at: string; completed_at: string | null;
    }[]>`SELECT id, status, rows_seen, inserted_rows, repeat_rows, rejected_rows, error, started_at::text, completed_at::text FROM app.google_sheet_sync_runs WHERE tenant_id = ${user.tenantId} AND google_sheet_connection_id = ${connection.id} ORDER BY started_at DESC LIMIT 5` : [];
    return { connection: connection ?? null, runs };
  });
  return NextResponse.json({ demo: false, credentialsConfigured: googleCredentialsConfigured(), serviceAccountEmail: env().GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null, enabledByEnvironment: env().GOOGLE_SHEETS_ENABLED === "true", ...result });
}

export async function PUT(request: Request) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!authorize(user.role)) return NextResponse.json({ error: "Owner or admin access required" }, { status: 403 });
  const parsed = googleSheetConnectionInputSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid connection settings" }, { status: 400 });
  let spreadsheetId: string;
  try { spreadsheetId = extractSpreadsheetId(parsed.data.spreadsheet); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid spreadsheet" }, { status: 400 }); }
  if (env().DEMO_MODE === "true") return NextResponse.json({ saved: false, validated: true, demo: true, message: "Settings are valid. Production mode is required to save the connection." });
  const connection = await withTenant(user, async (transaction) => {
    let [source] = await transaction<{ id: string }[]>`SELECT id FROM app.source_connections WHERE tenant_id = ${user.tenantId} AND source = 'csv_import' AND config ->> 'transport' = 'google_sheets' LIMIT 1`;
    if (!source) [source] = await transaction<{ id: string }[]>`
      INSERT INTO app.source_connections (tenant_id, source, name, status, config)
      VALUES (${user.tenantId}, 'csv_import', 'Google Sheets', ${parsed.data.enabled ? "healthy" : "draft"}, ${transaction.json({ transport: "google_sheets" })}) RETURNING id
    `;
    const [saved] = await transaction<{ id: string }[]>`
      INSERT INTO app.google_sheet_connections (tenant_id, source_connection_id, spreadsheet_id, sheet_name, header_row, mapping, enabled, created_by)
      VALUES (${user.tenantId}, ${source.id}, ${spreadsheetId}, ${parsed.data.sheetName}, ${parsed.data.headerRow}, ${transaction.json(parsed.data.mapping)}, ${parsed.data.enabled}, ${user.id})
      ON CONFLICT (tenant_id, source_connection_id) DO UPDATE SET spreadsheet_id = excluded.spreadsheet_id, sheet_name = excluded.sheet_name,
        header_row = excluded.header_row, mapping = excluded.mapping, enabled = excluded.enabled, last_error = NULL
      RETURNING id
    `;
    await transaction`UPDATE app.source_connections SET status = ${parsed.data.enabled ? "healthy" : "draft"} WHERE tenant_id = ${user.tenantId} AND id = ${source.id}`;
    await transaction`INSERT INTO app.audit_log (tenant_id, actor_id, action, target_type, target_id, payload) VALUES (${user.tenantId}, ${user.id}, 'google_sheet_connection_saved', 'google_sheet_connection', ${saved.id}, ${transaction.json({ spreadsheetId, sheetName: parsed.data.sheetName, enabled: parsed.data.enabled })})`;
    return saved;
  });
  return NextResponse.json({ saved: true, connectionId: connection.id });
}
