import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db";
import { readSession } from "@/lib/auth";

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const schema = z.object({
  opensAt: z.string().regex(timePattern),
  closesAt: z.string().regex(timePattern),
  closedWeekdays: z.array(z.number().int().min(0).max(6)).default([]),
  followupDays: z.number().int().min(1).max(14).default(4),
}).refine((value) => value.opensAt < value.closesAt, { message: "Closing time must be after opening time" });

export async function GET() {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  const result = await withTenant(user, async (transaction) => {
    const [store] = await transaction<{ id: string; name: string }[]>`SELECT id,name FROM app.stores WHERE tenant_id=${user.tenantId} AND is_default AND active ORDER BY created_at LIMIT 1`;
    if (!store) return null;
    const hours = await transaction<{ weekday: number; opens_at: string; closes_at: string; enabled: boolean }[]>`
      SELECT weekday,opens_at::text,closes_at::text,enabled FROM app.business_hours
      WHERE tenant_id=${user.tenantId} AND store_id=${store.id} ORDER BY weekday
    `;
    const [tenant] = await transaction<{ followup_days: number }[]>`SELECT followup_days FROM app.tenants WHERE tenant_id=${user.tenantId}`;
    const first = hours.find((item) => item.enabled) ?? hours[0];
    return { store, opensAt: first?.opens_at.slice(0,5) ?? "10:30", closesAt: first?.closes_at.slice(0,5) ?? "20:30", closedWeekdays: hours.filter((item) => !item.enabled).map((item) => item.weekday), followupDays: tenant?.followup_days ?? 4 };
  });
  return result ? NextResponse.json(result) : NextResponse.json({ error: "Default store not found" }, { status: 404 });
}

export async function PUT(request: Request) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Store hours are invalid" }, { status: 400 });
  await withTenant(user, async (transaction) => {
    const [store] = await transaction<{ id: string }[]>`SELECT id FROM app.stores WHERE tenant_id=${user.tenantId} AND is_default AND active ORDER BY created_at LIMIT 1`;
    if (!store) throw new Error("Default store not found");
    for (let weekday = 0; weekday < 7; weekday += 1) await transaction`
      INSERT INTO app.business_hours (tenant_id,store_id,weekday,opens_at,closes_at,enabled)
      VALUES (${user.tenantId},${store.id},${weekday},${parsed.data.opensAt},${parsed.data.closesAt},${!parsed.data.closedWeekdays.includes(weekday)})
      ON CONFLICT (tenant_id,store_id,weekday) DO UPDATE SET opens_at=excluded.opens_at,closes_at=excluded.closes_at,enabled=excluded.enabled
    `;
    await transaction`UPDATE app.tenants SET followup_days=${parsed.data.followupDays} WHERE tenant_id=${user.tenantId}`;
    await transaction`INSERT INTO app.audit_log (tenant_id,actor_id,action,target_type,target_id,payload) VALUES (${user.tenantId},${user.id},'store_hours_updated','store',${store.id},${transaction.json(parsed.data)})`;
  });
  return NextResponse.json({ ok: true });
}
