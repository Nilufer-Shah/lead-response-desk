import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db";
import { readSession } from "@/lib/auth";

const schema = z.object({ answer: z.enum(["yes", "no"]), note: z.string().trim().min(10).max(2000) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role === "agency") return NextResponse.json({ error: "Agency access is read-only" }, { status: 403 });
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json());
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Follow-up id is invalid" }, { status: 400 });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Follow-up response is invalid" }, { status: 422 });
  const result = await withTenant(user, async (transaction) => {
    const [followup] = await transaction<{ id: string; lead_id: string; day_number: number; status: string }[]>`
      SELECT f.id,f.lead_id,f.day_number,f.status::text
      FROM app.lead_followups f JOIN app.leads l ON l.tenant_id=f.tenant_id AND l.id=f.lead_id
      WHERE f.tenant_id=${user.tenantId} AND f.id=${id} AND f.status IN ('pending','missed')
      FOR UPDATE OF f
    `;
    if (!followup) return { notFound: true as const };
    const [attempt] = parsed.data.answer === "yes" ? await transaction<{ id: string }[]>`
      SELECT id FROM app.attempts
      WHERE tenant_id=${user.tenantId} AND lead_id=${followup.lead_id}
        AND channel IN ('call','whatsapp')
        AND (initiated_at AT TIME ZONE 'Asia/Kolkata')::date=(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
      ORDER BY initiated_at DESC LIMIT 1
    ` : [];
    if (parsed.data.answer === "yes" && !attempt) return { attemptRequired: true as const };
    await transaction`
      UPDATE app.lead_followups SET status='done',answer=${parsed.data.answer}::app.followup_answer,note=${parsed.data.note},
        attempt_id=${attempt?.id ?? null},answered_at=clock_timestamp(),answered_by=${user.id}
      WHERE tenant_id=${user.tenantId} AND id=${id}
    `;
    await transaction`INSERT INTO app.lead_events (tenant_id,lead_id,event_type,actor_id,actor_type,payload) VALUES (${user.tenantId},${followup.lead_id},'followup_answered',${user.id},'user',${transaction.json({ followupId: id, dayNumber: followup.day_number, answer: parsed.data.answer, note: parsed.data.note, attemptId: attempt?.id })})`;
    const [cadence] = await transaction<{ pending: number; max_day: number; required_days: number }[]>`
      SELECT count(*) FILTER (WHERE f.status='pending')::int AS pending,max(f.day_number)::int AS max_day,t.followup_days AS required_days
      FROM app.lead_followups f JOIN app.leads l ON l.tenant_id=f.tenant_id AND l.id=f.lead_id
      JOIN app.tenants t ON t.tenant_id=l.tenant_id
      WHERE f.tenant_id=${user.tenantId} AND f.lead_id=${followup.lead_id} AND f.created_at>=l.received_at
      GROUP BY t.followup_days
    `;
    if (cadence && cadence.pending === 0 && cadence.max_day >= cadence.required_days) await transaction`
      UPDATE app.leads SET stage='dormant',conversation_state='waiting_on_us',next_action_at=NULL
      WHERE tenant_id=${user.tenantId} AND id=${followup.lead_id} AND stage IN ('contacted','follow_up')
    `;
    return { ok: true as const };
  });
  if ("notFound" in result) return NextResponse.json({ error: "Open follow-up not found" }, { status: 404 });
  if ("attemptRequired" in result) return NextResponse.json({ error: "Make a Call or WhatsApp attempt today before answering Yes." }, { status: 422 });
  return NextResponse.json({ ok: true });
}
