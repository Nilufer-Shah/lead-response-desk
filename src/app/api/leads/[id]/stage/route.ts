import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db";
import { env } from "@/lib/env";
import { readSession } from "@/lib/auth";

const stages = ["new", "contacted", "qualified", "visit_booked", "visited", "won", "lost"] as const;
const rank = new Map(stages.map((stage, index) => [stage, index]));
const schema = z.object({ stage: z.enum(stages), requirementNote: z.string().optional(), visitAt: z.string().datetime().optional(), orderValue: z.number().positive().optional(), reopenReason: z.string().trim().min(5).optional() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role === "agency") return NextResponse.json({ error: "Agency access is read-only" }, { status: 403 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Lead ID is invalid" }, { status: 400 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Stage details are invalid" }, { status: 400 });
  if (env().DEMO_MODE === "true") return NextResponse.json({ ok: true, stage: parsed.data.stage, changedAt: new Date().toISOString() });

  const result = await withTenant(user, async (transaction) => {
    const [lead] = await transaction<{ stage: typeof stages[number]; attempt_count: number }[]>`
      SELECT stage, attempt_count FROM app.leads WHERE tenant_id = ${user.tenantId} AND id = ${id} FOR UPDATE
    `;
    if (!lead) return { status: 404, error: "Lead not found" };
    if ((rank.get(parsed.data.stage) ?? 0) < (rank.get(lead.stage) ?? 0) && !parsed.data.reopenReason) return { status: 422, error: "A reason is required to reopen or move a lead backwards" };
    if (parsed.data.stage === "contacted" && lead.attempt_count < 1) return { status: 422, error: "Record an attempt before moving this lead to Contacted" };
    if (parsed.data.stage === "qualified" && (parsed.data.requirementNote?.trim().length ?? 0) < 20) return { status: 422, error: "Add at least 20 characters about the requirement before qualifying this lead" };
    if (parsed.data.stage === "visit_booked" && !parsed.data.visitAt) return { status: 422, error: "Choose the visit date and time" };
    if (parsed.data.stage === "won" && !parsed.data.orderValue) return { status: 422, error: "Enter the order value before marking this lead Won" };
    if (parsed.data.stage === "lost") return { status: 422, error: "Use the close action so the evidence gate and close reason are recorded" };
    const backwards = (rank.get(parsed.data.stage) ?? 0) < (rank.get(lead.stage) ?? 0);
    await transaction`
      UPDATE app.leads SET stage = ${parsed.data.stage}, order_value = COALESCE(${parsed.data.orderValue ?? null}, order_value),
        conversation_state = CASE WHEN ${parsed.data.stage} IN ('won') THEN 'closed'::app.conversation_state ELSE conversation_state END,
        closed_at = CASE WHEN ${parsed.data.stage} = 'won' THEN clock_timestamp() ELSE closed_at END
      WHERE tenant_id = ${user.tenantId} AND id = ${id}
    `;
    if (parsed.data.requirementNote) await transaction`
      INSERT INTO app.notes (tenant_id, lead_id, user_id, body) VALUES (${user.tenantId}, ${id}, ${user.id}, ${parsed.data.requirementNote})
    `;
    await transaction`
      INSERT INTO app.lead_events (tenant_id, lead_id, event_type, actor_id, actor_type, payload)
      VALUES (${user.tenantId}, ${id}, ${backwards ? "reopened" : "stage_changed"}, ${user.id}, 'user', ${JSON.stringify({ fromStage: lead.stage, toStage: parsed.data.stage, visitAt: parsed.data.visitAt, orderValue: parsed.data.orderValue, reason: parsed.data.reopenReason })}::jsonb)
    `;
    if (parsed.data.stage === "visit_booked" || parsed.data.stage === "visited") await transaction`
      INSERT INTO app.lead_events (tenant_id, lead_id, event_type, actor_id, actor_type, payload)
      VALUES (${user.tenantId}, ${id}, ${parsed.data.stage === "visit_booked" ? "visit_booked" : "visit_done"}, ${user.id}, 'user', ${transaction.json({ visitAt: parsed.data.visitAt })})
    `;
    return { status: 200, ok: true, stage: parsed.data.stage };
  });
  return NextResponse.json(result, { status: result.status });
}
