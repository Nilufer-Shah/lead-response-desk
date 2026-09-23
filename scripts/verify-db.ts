import postgres from "postgres";

const connectionString = process.env.DATABASE_URL ?? "postgres://lead_desk:lead_desk@localhost:5432/lead_desk";
const sql = postgres(connectionString, { max: 1, prepare: false });

async function main() {
  await sql`SELECT app.assert_tenant_security()`;
  const [summary] = await sql<{ app_tables: number; protected_tables: number; tenant_columns: number }[]>`
    SELECT count(DISTINCT c.oid)::integer AS app_tables,
      count(DISTINCT c.oid) FILTER (WHERE c.relrowsecurity AND c.relforcerowsecurity AND EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname=n.nspname AND p.tablename=c.relname))::integer AS protected_tables,
      count(DISTINCT c.oid) FILTER (WHERE EXISTS (SELECT 1 FROM information_schema.columns col WHERE col.table_schema=n.nspname AND col.table_name=c.relname AND col.column_name='tenant_id' AND col.is_nullable='NO'))::integer AS tenant_columns
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='app' AND c.relkind IN ('r','p')
  `;
  if (summary.app_tables !== summary.protected_tables || summary.app_tables !== summary.tenant_columns) throw new Error("Tenant security catalog contract failed");

  const applicationUrl = new URL(connectionString);
  applicationUrl.username = "lead_desk_app";
  applicationUrl.password = process.env.POSTGRES_APP_PASSWORD ?? "lead_desk_app";
  process.env.DATABASE_URL = applicationUrl.toString();
  const { getLeadList, getProductDashboard, getTodayQueue } = await import("../src/services/product-read-models");
  const { closeDatabase } = await import("../src/db");
  const tenantId = process.env.DEFAULT_TENANT_ID ?? "11111111-1111-4111-8111-111111111111";
  const [ownerRow] = await sql<{ id: string; display_name: string }[]>`
    SELECT id,display_name FROM app.users WHERE tenant_id=${tenantId} AND role='owner' AND status='active' ORDER BY created_at LIMIT 1
  `;
  if (!ownerRow) throw new Error("No active bootstrap owner was found");
  const owner = { id: ownerRow.id, tenantId, name: ownerRow.display_name, role: "owner" as const };
  const [ownerLeads, dashboard, today] = await Promise.all([
    getLeadList(owner), getProductDashboard(owner,"today"), getTodayQueue(owner),
  ]);
  if (!Array.isArray(dashboard.people) || !Array.isArray(today.newLeads)) throw new Error("A core read model returned incomplete data");
  process.stdout.write(`Tenant security verified: ${summary.protected_tables}/${summary.app_tables}; fresh read models owner_leads=${ownerLeads.length}.\n`);
  await closeDatabase();
}

main().finally(() => sql.end());
