import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db";
import { env } from "@/lib/env";
import { readSession } from "@/lib/auth";

const eventTypes = ["disposition_logged", "whatsapp_queued", "whatsapp_sent", "whatsapp_delivered", "whatsapp_read", "whatsapp_replied", "whatsapp_failed", "duration_reported", "note_added"] as const;
const schema = z.object({ eventType: z.enum(eventTypes), payload: z.record(z.string(), z.unknown()).default({}) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role === "agency") return NextResponse.json({ error: "Agency access is read-only" }, { status: 403 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Attempt ID is invalid" }, { status: 400 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Attempt event is invalid" }, { status: 400 });
  if (env().DEMO_MODE === "true") return NextResponse.json({ id: crypto.randomUUID(), ...parsed.data, occurredAt: new Date().toISOString() }, { status: 201 });

  const created = await withTenant(user, async (transaction) => {
    const [attempt] = await transaction<{ id: string; lead_id: string }[]>`SELECT id, lead_id FROM app.attempts WHERE tenant_id = ${user.tenantId} AND id = ${id}`;
    if (!attempt) return null;
    const [event] = await transaction<{ id: string; occurred_at: Date }[]>`
      INSERT INTO app.attempt_events (tenant_id, attempt_id, event_type, payload)
      VALUES (${user.tenantId}, ${id}, ${parsed.data.eventType}, ${JSON.stringify(parsed.data.payload)}::jsonb)
      RETURNING id, occurred_at
    `;
    if (parsed.data.eventType === "disposition_logged") {
      const disposition = String(parsed.data.payload.disposition ?? "");
      const connected = ["connected", "interested", "visit_booked"].includes(disposition);
      const [lead] = await transaction<{ attempt_count: number }[]>`SELECT attempt_count FROM app.leads WHERE tenant_id = ${user.tenantId} AND id = ${attempt.lead_id}`;
      const delay = connected ? "2 days" : [null, "2 hours", "1 day", "3 days", "7 days"][lead?.attempt_count ?? 0] ?? null;
      await transaction`
        UPDATE app.leads
        SET
          first_connect_at = CASE WHEN ${connected} THEN LEAST(COALESCE(first_connect_at, clock_timestamp()), clock_timestamp()) ELSE first_connect_at END,
          conversation_state = CASE WHEN ${connected} THEN 'waiting_on_lead'::app.conversation_state ELSE 'waiting_on_us'::app.conversation_state END,
          next_action_at = CASE WHEN ${delay}::text IS NULL THEN NULL ELSE clock_timestamp() + (${delay}::text)::interval END
        WHERE tenant_id = ${user.tenantId} AND id = ${attempt.lead_id}
      `;
      if (delay) {
        await transaction`
          INSERT INTO app.jobs (tenant_id, kind, idempotency_key, payload, scheduled_at)
          VALUES (
            ${user.tenantId}, 'followup.due', ${`followup:${attempt.lead_id}:${lead?.attempt_count ?? 0}`},
            ${JSON.stringify({ leadId: attempt.lead_id, attemptNumber: lead?.attempt_count ?? 0 })}::jsonb,
            clock_timestamp() + (${delay})::interval
          ) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
        `;
      }
    }
    return event;
  });
  if (!created) return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
  return NextResponse.json({ id: created.id, ...parsed.data, occurredAt: created.occurred_at.toISOString() }, { status: 201 });
}
