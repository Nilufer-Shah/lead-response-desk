import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db";
import { env } from "@/lib/env";
import { demoLeads, leadTimeline } from "@/lib/demo-data";
import { readSession } from "@/lib/auth";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Lead ID is invalid" }, { status: 400 });
  if (env().DEMO_MODE === "true") {
    const lead = demoLeads.find((item) => item.id === id);
    return lead ? NextResponse.json({ lead, timeline: leadTimeline }) : NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  const result = await withTenant(user, async (transaction) => {
    const [lead] = await transaction`
      SELECT id, source, external_id, form_name, campaign_name, ad_name, creative_thumb,
        full_name, phone_e164, email, city, is_international, custom_fields, stage,
        conversation_state, assigned_to, store_id, enquiry_count, lead_created_at,
        received_at, first_touch_at, first_connect_at, sla_due_at, sla_breached,
        attempt_count, next_action_at, close_reason, quality_flag, order_value
      FROM app.leads WHERE tenant_id = ${user.tenantId} AND id = ${id}
    `;
    if (!lead) return null;
    const timeline = await transaction`
      SELECT id, event_type, actor_id, actor_type, payload, occurred_at
      FROM app.lead_events WHERE tenant_id = ${user.tenantId} AND lead_id = ${id}
      UNION ALL
      SELECT id, 'note_added', user_id, 'user', jsonb_build_object('body', body, 'client_initiated_at', client_initiated_at), created_at
      FROM app.notes WHERE tenant_id = ${user.tenantId} AND lead_id = ${id}
      ORDER BY occurred_at DESC
    `;
    return { lead, timeline };
  });
  return result ? NextResponse.json(result) : NextResponse.json({ error: "Lead not found" }, { status: 404 });
}
