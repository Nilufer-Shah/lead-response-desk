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
  const { getLeadDetail, getLeadList, getProductDashboard, getTodayQueue } = await import("../src/services/product-read-models");
  const { closeDatabase } = await import("../src/db");
  const owner = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", tenantId: "11111111-1111-4111-8111-111111111111", name: "Harsh Shah", role: "owner" as const };
  const salesperson = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", tenantId: owner.tenantId, name: "Ashwini", role: "salesperson" as const };
  const [ownerLeads, staffLeads, dashboard, today, detail] = await Promise.all([
    getLeadList(owner), getLeadList(salesperson), getProductDashboard(owner,"today"), getTodayQueue(salesperson),
    getLeadDetail(owner,"90000000-0000-4000-8000-000000000001"),
  ]);
  if (ownerLeads.length < 18) throw new Error(`Expected at least 18 owner leads, received ${ownerLeads.length}`);
  if (!staffLeads.length || staffLeads.some((lead) => lead.owner !== "Ashwini")) throw new Error("Salesperson read model escaped assignment scope");
  if (!dashboard.people.length || !detail?.timeline.length || !Array.isArray(today.newLeads)) throw new Error("A Block 1 read model returned incomplete data");
  process.stdout.write(`Tenant security verified: ${summary.protected_tables}/${summary.app_tables}; Block 1 read models owner=${ownerLeads.length}, staff=${staffLeads.length}.\n`);
  await closeDatabase();
}

main().finally(() => sql.end());
