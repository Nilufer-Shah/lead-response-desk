import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db";
import { readSession } from "@/lib/auth";

const deadReasons = ["not_interested", "bought_elsewhere", "price_too_high", "other"] as const;
const badReasons = ["spam", "wrong_number", "not_reachable", "fake_enquiry"] as const;
const schema = z.object({
  outcome: z.enum(["won", "dead", "bad"]),
  reason: z.string().trim().optional(),
  note: z.string().trim().optional(),
  orderValue: z.number().positive().optional(),
}).superRefine((value, context) => {
  if (value.outcome === "won" && !value.orderValue) context.addIssue({ code: "custom", message: "Order value is required", path: ["orderValue"] });
  if (value.outcome === "dead" && !deadReasons.includes(value.reason as typeof deadReasons[number])) context.addIssue({ code: "custom", message: "Choose a valid Dead reason", path: ["reason"] });
  if (value.outcome === "bad" && !badReasons.includes(value.reason as typeof badReasons[number])) context.addIssue({ code: "custom", message: "Choose a valid Bad reason", path: ["reason"] });
  if (value.outcome === "dead" && value.reason === "other" && !value.note?.trim()) context.addIssue({ code: "custom", message: "Add a note for Other", path: ["note"] });
});

async function gate(user: NonNullable<Awaited<ReturnType<typeof readSession>>>, leadId: string, outcome: string, reason?: string) {
  return withTenant(user, async (transaction) => {
    const [lead] = await transaction<{ id: string }[]>`SELECT id FROM app.leads WHERE tenant_id=${user.tenantId} AND id=${leadId}`;
    if (!lead) return null;
    const [row] = await transaction<{ gate: { allowed: boolean; attempts: number; distinct_days: number; required_attempts: number; required_days: number } }[]>`
      SELECT app.outcome_gate_status(${user.tenantId},${leadId},${outcome},${reason ?? null}) AS gate
    `;
    return row?.gate;
  });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await context.params;
  const url = new URL(request.url);
  const outcome = url.searchParams.get("outcome");
  const reason = url.searchParams.get("reason") ?? undefined;
  if (!z.string().uuid().safeParse(id).success || !["won","dead","bad"].includes(outcome ?? "")) return NextResponse.json({ error: "Gate request is invalid" }, { status: 400 });
  const result = await gate(user, id, outcome!, reason);
  return result ? NextResponse.json(result) : NextResponse.json({ error: "Lead not found" }, { status: 404 });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role === "agency") return NextResponse.json({ error: "Agency access is read-only" }, { status: 403 });
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json());
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: parsed.error?.issues[0]?.message ?? "Outcome details are invalid" }, { status: 400 });
  const result = await withTenant(user, async (transaction) => {
    const [lead] = await transaction<{ id: string }[]>`SELECT id FROM app.leads WHERE tenant_id=${user.tenantId} AND id=${id} FOR UPDATE`;
    if (!lead) return { notFound: true as const };
    const [row] = await transaction<{ gate: { allowed: boolean; attempts: number; distinct_days: number; required_attempts: number; required_days: number } }[]>`
      SELECT app.outcome_gate_status(${user.tenantId},${id},${parsed.data.outcome},${parsed.data.reason ?? null}) AS gate
    `;
    if (!row?.gate) return { notFound: true as const };
    if (!row.gate.allowed) return { blocked: true as const, gate: row.gate };
    await transaction`
      UPDATE app.leads SET stage=${parsed.data.outcome}::app.lead_stage,outcome_reason=${parsed.data.reason ?? null},
        order_value=${parsed.data.orderValue ?? null},closed_at=clock_timestamp(),closed_by=${user.id},conversation_state='closed',next_action_at=NULL
      WHERE tenant_id=${user.tenantId} AND id=${id}
    `;
    await transaction`
      UPDATE app.lead_followups SET status='cancelled'
      WHERE tenant_id=${user.tenantId} AND lead_id=${id} AND status='pending'
    `;
    await transaction`INSERT INTO app.lead_events (tenant_id,lead_id,event_type,actor_id,actor_type,payload) VALUES (${user.tenantId},${id},'outcome_recorded',${user.id},'user',${transaction.json(parsed.data)})`;
    return { ok: true as const };
  });
  if ("notFound" in result) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if ("blocked" in result) {
    const gateStatus = result.gate;
    if (!gateStatus) return NextResponse.json({ error: "Evidence gate is unavailable" }, { status: 500 });
    const missing = [];
    if (gateStatus.attempts < gateStatus.required_attempts) missing.push(`${gateStatus.required_attempts - gateStatus.attempts} more contact attempt${gateStatus.required_attempts - gateStatus.attempts === 1 ? "" : "s"}`);
    if (gateStatus.distinct_days < gateStatus.required_days) missing.push(`${gateStatus.required_days - gateStatus.distinct_days} more contact day${gateStatus.required_days - gateStatus.distinct_days === 1 ? "" : "s"}`);
    return NextResponse.json({ error: `${missing.join(" and ")} needed`, ...gateStatus }, { status: 422 });
  }
  return NextResponse.json({ ok: true });
}
