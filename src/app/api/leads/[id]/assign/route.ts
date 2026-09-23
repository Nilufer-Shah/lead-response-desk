import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db";
import { env } from "@/lib/env";
import { readSession } from "@/lib/auth";

const schema = z.object({ userId: z.string().uuid(), reason: z.string().trim().min(5).max(500) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!(["manager", "owner", "admin"] as string[]).includes(user.role)) return NextResponse.json({ error: "Manager or owner access required" }, { status: 403 });
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json());
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Assignment details are invalid" }, { status: 400 });
  if (env().DEMO_MODE === "true") return NextResponse.json({ ok: true, assignedTo: parsed.data.userId });
  const result = await withTenant(user, async (transaction) => {
    const [lead] = await transaction<{ assigned_to: string | null; sla_due_at: Date; sla_breached: boolean }[]>`SELECT assigned_to, sla_due_at, sla_breached FROM app.leads WHERE tenant_id = ${user.tenantId} AND id = ${id}`;
    const [assignee] = await transaction<{ id: string }[]>`SELECT id FROM app.users WHERE tenant_id = ${user.tenantId} AND id = ${parsed.data.userId} AND role = 'salesperson' AND status = 'active'`;
    if (!lead || !assignee) return null;
    await transaction`UPDATE app.leads SET assigned_to = ${assignee.id}, assigned_at = clock_timestamp() WHERE tenant_id = ${user.tenantId} AND id = ${id}`;
    await transaction`
      INSERT INTO app.lead_events (tenant_id, lead_id, event_type, actor_id, actor_type, payload)
      VALUES (${user.tenantId}, ${id}, 'reassigned', ${user.id}, 'user', ${JSON.stringify({ fromUserId: lead.assigned_to, toUserId: assignee.id, reason: parsed.data.reason, slaDueAtUnchanged: lead.sla_due_at, breachUnchanged: lead.sla_breached })}::jsonb)
    `;
    return { assignedTo: assignee.id, slaDueAt: lead.sla_due_at, slaBreached: lead.sla_breached };
  });
  return result ? NextResponse.json({ ok: true, ...result }) : NextResponse.json({ error: "Lead or salesperson not found" }, { status: 404 });
}
