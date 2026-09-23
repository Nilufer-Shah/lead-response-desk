import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db";
import { readSession } from "@/lib/auth";
import { env } from "@/lib/env";

const formSchema = z.object({ formId: z.string().trim().min(1), name: z.string().trim().min(1), mapping: z.object({ fullName: z.string().trim().min(1), phone: z.string().trim().min(1), email: z.string().trim().min(1), city: z.string().trim().min(1) }) });
const inputSchema = z.object({ forms: z.array(formSchema).max(100) });

async function owner() { const user = await readSession(); return user?.role === "owner" ? user : null; }

export async function GET() {
  const user = await owner(); if (!user) return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  const data = await withTenant(user, async (transaction) => {
    const [connection] = await transaction<{ source_connection_id: string; last_webhook_at: string | null; last_healthy_at: string | null; last_reconciled_at: string | null; last_reconciliation_result: unknown }[]>`
      SELECT source_connection_id,last_webhook_at::text,last_healthy_at::text,last_reconciled_at::text,last_reconciliation_result FROM app.meta_connections WHERE tenant_id=${user.tenantId} ORDER BY created_at LIMIT 1`;
    const forms = connection ? await transaction<{ id: string; external_id: string; name: string; source_field: string | null; target_field: string | null }[]>`
      SELECT f.id,f.external_id,f.name,m.source_field,m.target_field FROM app.source_forms f LEFT JOIN app.form_field_map m ON m.tenant_id=f.tenant_id AND m.source_form_id=f.id
      WHERE f.tenant_id=${user.tenantId} AND f.source_connection_id=${connection.source_connection_id} AND f.active ORDER BY f.external_id` : [];
    const grouped = new Map<string, { formId: string; name: string; mapping: Record<string, string> }>();
    for (const row of forms) { const value = grouped.get(row.id) ?? { formId: row.external_id, name: row.name, mapping: { fullName: "full_name", phone: "phone_number", email: "email", city: "city" } }; if (row.source_field && row.target_field) { const key = ({ fullNameRaw: "fullName", phoneRaw: "phone", emailRaw: "email", cityRaw: "city" } as Record<string,string>)[row.target_field]; if (key) value.mapping[key] = row.source_field; } grouped.set(row.id, value); }
    return { connection: connection ?? null, forms: [...grouped.values()] };
  });
  return NextResponse.json({ enabledByEnvironment: env().META_CONNECTION_ENABLED === "true", credentialsConfigured: Boolean(env().META_APP_ID && env().META_APP_SECRET && env().META_VERIFY_TOKEN && env().META_SYSTEM_USER_TOKEN), graphVersion: env().META_GRAPH_VERSION, ...data });
}

export async function PUT(request: Request) {
  const user = await owner(); if (!user) return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  const parsed = inputSchema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid Meta settings" }, { status: 400 });
  await withTenant(user, async (transaction) => {
    let [source] = await transaction<{ id: string }[]>`SELECT id FROM app.source_connections WHERE tenant_id=${user.tenantId} AND source='meta_lead_form' ORDER BY created_at LIMIT 1`;
    if (!source) [source] = await transaction<{ id: string }[]>`INSERT INTO app.source_connections (tenant_id,source,name,status,config) VALUES (${user.tenantId},'meta_lead_form','Meta Lead Ads','draft','{}') RETURNING id`;
    await transaction`INSERT INTO app.meta_connections (tenant_id,source_connection_id) VALUES (${user.tenantId},${source.id}) ON CONFLICT (tenant_id,source_connection_id) DO NOTHING`;
    await transaction`UPDATE app.source_forms SET active=false,updated_at=clock_timestamp() WHERE tenant_id=${user.tenantId} AND source_connection_id=${source.id}`;
    for (const form of parsed.data.forms) {
      const [saved] = await transaction<{ id: string }[]>`INSERT INTO app.source_forms (tenant_id,source_connection_id,external_id,name,active) VALUES (${user.tenantId},${source.id},${form.formId},${form.name},true) ON CONFLICT (tenant_id,external_id) DO UPDATE SET name=excluded.name,active=true,source_connection_id=excluded.source_connection_id,updated_at=clock_timestamp() RETURNING id`;
      const fields = [[form.mapping.fullName,"fullNameRaw"],[form.mapping.phone,"phoneRaw"],[form.mapping.email,"emailRaw"],[form.mapping.city,"cityRaw"]] as const;
      await transaction`DELETE FROM app.form_field_map WHERE tenant_id=${user.tenantId} AND source_form_id=${saved.id}`;
      for (const [sourceField,targetField] of fields) await transaction`INSERT INTO app.form_field_map (tenant_id,source_form_id,source_field,target_field) VALUES (${user.tenantId},${saved.id},${sourceField},${targetField})`;
    }
    await transaction`INSERT INTO app.audit_log (tenant_id,actor_id,action,target_type,target_id,payload) VALUES (${user.tenantId},${user.id},'meta_forms_saved','meta_connection',${source.id},${transaction.json({ formIds: parsed.data.forms.map((form) => form.formId) })})`;
  });
  return NextResponse.json({ saved: true });
}
