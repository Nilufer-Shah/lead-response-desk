import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateCloseGate, remainingRequirementCopy } from "@/domain/close-gate";
import { readSession } from "@/lib/auth";
import { withTenant } from "@/db";
import { env } from "@/lib/env";

const closeReasons = ["bought", "bought_elsewhere", "price_too_high", "out_of_area", "just_browsing", "unreachable", "wrong_number", "invalid_number", "duplicate", "spam", "no_response"] as const;
const qualityFlags = ["unrated", "good", "invalid_number", "wrong_person", "out_of_area", "budget_mismatch", "competitor", "spam", "duplicate"] as const;
const schema = z.object({ closeReason: z.enum(closeReasons).optional(), qualityFlag: z.enum(qualityFlags).optional(), note: z.string().optional(), linkedLeadId: z.string().uuid().optional(), orderValue: z.number().positive().optional(), attempts: z.array(z.object({ channel: z.enum(["call", "whatsapp", "sms", "email", "in_person"]), initiatedAt: z.coerce.date(), whatsappSendAttempted: z.boolean().optional(), invalidNumberEvidence: z.boolean().optional() })).default([]) }).refine((value) => value.closeReason || value.qualityFlag, { message: "Choose a close reason or quality flag" });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role === "agency") return NextResponse.json({ error: "Agency access is read-only" }, { status: 403 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Closure details are invalid" }, { status: 400 });
  const { id: leadId } = await context.params;
  if (!z.string().uuid().safeParse(leadId).success) return NextResponse.json({ error: "Lead ID is invalid" }, { status: 400 });
  if (env().DEMO_MODE === "false") {
    const outcome = await withTenant(user, async (transaction) => {
      const [gateRow] = await transaction<{ gate: { allowed: boolean; missing: Array<{ key: string; remaining: number }> } }[]>`
        SELECT app.close_gate_status(
          ${user.tenantId}, ${leadId}, ${parsed.data.closeReason ?? null}::app.close_reason,
          ${parsed.data.qualityFlag ?? null}::app.quality_flag, ${parsed.data.note ?? null}, ${parsed.data.linkedLeadId ?? null}
        ) AS gate
      `;
      if (!gateRow.gate.allowed) return { allowed: false as const, gate: gateRow.gate };
      if (parsed.data.closeReason === "bought" && !parsed.data.orderValue) {
        return { allowed: false as const, gate: { allowed: false, missing: [{ key: "orderValue", remaining: 1 }] } };
      }
      if (parsed.data.closeReason === "duplicate") {
        const [linked] = parsed.data.linkedLeadId ? await transaction<{ id: string }[]>`SELECT id FROM app.leads WHERE tenant_id=${user.tenantId} AND id=${parsed.data.linkedLeadId} AND id<>${leadId}` : [];
        if (!linked) return { allowed: false as const, gate: { allowed: false, missing: [{ key: "linked_lead", remaining: 1 }] } };
      }
      const needsInvalidEvidence = parsed.data.closeReason === "invalid_number" || parsed.data.qualityFlag === "invalid_number";
      const [evidence] = needsInvalidEvidence ? await transaction<{ id: string; attempt_id: string }[]>`
        SELECT ae.id, ae.attempt_id FROM app.attempts a JOIN app.attempt_events ae ON ae.tenant_id=a.tenant_id AND ae.attempt_id=a.id
        WHERE a.tenant_id=${user.tenantId} AND a.lead_id=${leadId}
          AND ((ae.event_type='disposition_logged' AND ae.payload->>'disposition'='invalid_number') OR (ae.event_type='whatsapp_failed' AND ae.payload->>'reason'='not_on_whatsapp'))
        ORDER BY ae.occurred_at DESC LIMIT 1
      ` : [];
      const [updated] = await transaction<{ id: string; closed_at: Date | null }[]>`
        UPDATE app.leads
        SET
          close_reason = COALESCE(${parsed.data.closeReason ?? null}::app.close_reason, close_reason),
          quality_flag = COALESCE(${parsed.data.qualityFlag ?? null}::app.quality_flag, quality_flag),
          order_value = COALESCE(${parsed.data.orderValue ?? null}, order_value),
          stage = CASE WHEN ${parsed.data.closeReason ?? null} = 'bought' THEN 'won'::app.lead_stage ELSE 'lost'::app.lead_stage END,
          conversation_state = 'closed', closed_at = clock_timestamp()
        WHERE tenant_id = ${user.tenantId} AND id = ${leadId}
        RETURNING id, closed_at
      `;
      if (!updated) return { allowed: false as const, notFound: true as const };
      await transaction`
        INSERT INTO app.lead_events (tenant_id, lead_id, event_type, actor_id, actor_type, payload, device, ip)
        VALUES (
          ${user.tenantId}, ${leadId}, 'lead_closed', ${user.id}, 'user',
          ${transaction.json({ closeReason: parsed.data.closeReason, qualityFlag: parsed.data.qualityFlag, note: parsed.data.note, linkedLeadId: parsed.data.linkedLeadId, orderValue: parsed.data.orderValue, evidenceReference: evidence ? { attemptId: evidence.attempt_id, attemptEventId: evidence.id } : undefined })},
          ${request.headers.get("user-agent")?.slice(0, 500) ?? null}, ${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null}
        )
      `;
      return { allowed: true as const, closedAt: updated.closed_at };
    });
    if (!outcome.allowed) {
      if ("notFound" in outcome) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
      const messages: Record<string, string> = { attempts: "more attempts", days: "another contact day", whatsapp: "a WhatsApp send attempt", note: "a longer note", evidence: "invalid-number evidence", linked_lead: "the original linked lead", orderValue: "order value" };
      return NextResponse.json({ error: outcome.gate.missing.map((item) => `${item.remaining} ${messages[item.key] ?? item.key} needed`).join(" and "), ...outcome.gate }, { status: 422 });
    }
    return NextResponse.json({ ok: true, closedAt: outcome.closedAt?.toISOString() });
  }
  const result = evaluateCloseGate(parsed.data as Parameters<typeof evaluateCloseGate>[0]);
  if (!result.allowed) return NextResponse.json({ error: remainingRequirementCopy(result.missing), ...result }, { status: 422 });
  return NextResponse.json({ ok: true, closedAt: new Date().toISOString() });
}
