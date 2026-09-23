import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db";
import { readSession } from "@/lib/auth";
import { env } from "@/lib/env";

const schema = z.object({ decision: z.enum(["approved", "returned"]), note: z.string().trim().max(1000).optional() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!(["owner", "manager", "admin"] as string[]).includes(user.role)) return NextResponse.json({ error: "Reviewer access required" }, { status: 403 });
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json());
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Review details are invalid" }, { status: 400 });
  if (env().DEMO_MODE === "true") return NextResponse.json({ ok: true, decision: parsed.data.decision });
  const created = await withTenant(user, async (transaction) => {
    const [lead] = await transaction<{ id: string; gate: { allowed: boolean; missing: Array<{ key: string; remaining: number }> } }[]>`
      SELECT l.id, app.close_gate_status(l.tenant_id,l.id,l.close_reason,l.quality_flag,
        (SELECT n.body FROM app.notes n WHERE n.tenant_id=l.tenant_id AND n.lead_id=l.id ORDER BY n.created_at DESC LIMIT 1),NULL) AS gate
      FROM app.leads l WHERE l.tenant_id=${user.tenantId} AND l.id=${id}
    `;
    if (!lead) return false;
    if (parsed.data.decision === "approved" && !lead.gate.allowed) return { blocked: true as const, missing: lead.gate.missing };
    await transaction`
      INSERT INTO app.lead_events (tenant_id, lead_id, event_type, actor_id, actor_type, payload)
      VALUES (${user.tenantId}, ${id}, ${parsed.data.decision === "approved" ? "quality_claim_approved" : "quality_claim_returned"}, ${user.id}, 'user', ${transaction.json({ note: parsed.data.note })})
    `;
    return { blocked: false as const };
  });
  if (!created) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (created.blocked) return NextResponse.json({ error: "This claim still needs more evidence before approval", missing: created.missing }, { status: 422 });
  return NextResponse.json({ ok: true, decision: parsed.data.decision });
}
