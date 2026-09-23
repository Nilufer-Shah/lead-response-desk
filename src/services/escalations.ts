import { withTenant } from "@/db";
import { addBusinessMinutes, type DailyHours, type Holiday } from "@/domain/sla";

interface EscalationLead {
  id: string; full_name: string | null; city: string | null; assigned_to: string | null; store_id: string | null;
  received_at: Date; first_touch_at: Date | null; sla_due_at: Date; sla_breached: boolean; is_international: boolean;
  first_touch_target_minutes: number; manager_escalation_minutes: number | null; owner_escalation_minutes: number; abandoned_minutes: number;
}

export async function processSlaEscalations(tenantId: string, now = new Date()) {
  return withTenant({ tenantId, userRole: "system" }, async (transaction) => {
    const leads = await transaction<EscalationLead[]>`
      SELECT l.id, l.full_name, l.city, l.assigned_to, l.store_id, l.received_at, l.first_touch_at,
        l.sla_due_at, l.sla_breached, l.is_international, p.first_touch_target_minutes,
        p.manager_escalation_minutes, p.owner_escalation_minutes, p.abandoned_minutes
      FROM app.leads l JOIN app.sla_policies p ON p.tenant_id = l.tenant_id AND p.id = l.sla_policy_version_id
      WHERE l.tenant_id = ${tenantId} AND l.first_touch_at IS NULL AND l.conversation_state <> 'closed'
    `;
    const users = await transaction<{ id: string; role: string; store_id: string | null }[]>`SELECT id, role, store_id FROM app.users WHERE tenant_id = ${tenantId} AND status = 'active'`;
    const hoursByStore = new Map<string, DailyHours[]>();
    const holidaysByStore = new Map<string, Holiday[]>();
    const hoursRows = await transaction<{ store_id: string; weekday: number; opens_at: string; closes_at: string; enabled: boolean }[]>`SELECT store_id, weekday, opens_at::text, closes_at::text, enabled FROM app.business_hours WHERE tenant_id = ${tenantId}`;
    for (const row of hoursRows) hoursByStore.set(row.store_id, [...(hoursByStore.get(row.store_id) ?? []), { weekday: row.weekday, opensAt: row.opens_at.slice(0, 5), closesAt: row.closes_at.slice(0, 5), enabled: row.enabled }]);
    const holidayRows = await transaction<{ store_id: string; holiday_date: string; closed: boolean; opens_at: string | null; closes_at: string | null }[]>`SELECT store_id, holiday_date::text, closed, opens_at::text, closes_at::text FROM app.store_holidays WHERE tenant_id = ${tenantId}`;
    for (const row of holidayRows) holidaysByStore.set(row.store_id, [...(holidaysByStore.get(row.store_id) ?? []), { date: row.holiday_date, closed: row.closed, opensAt: row.opens_at?.slice(0, 5), closesAt: row.closes_at?.slice(0, 5) }]);
    const owner = users.find((user) => user.role === "owner");
    let queued = 0;
    const enqueue = async (lead: EscalationLead, recipientUserId: string | null | undefined, template: string, threshold: number) => {
      if (!recipientUserId) return;
      const result = await transaction`
        INSERT INTO app.notifications (tenant_id, lead_id, recipient_user_id, channel, template, deduplication_key, payload)
        VALUES (${tenantId}, ${lead.id}, ${recipientUserId}, 'whatsapp', ${template}, ${`sla:${lead.id}:${template}:${threshold}`}, ${JSON.stringify({ leadName: lead.full_name, city: lead.city, elapsedMinutes: threshold, assignedTo: lead.assigned_to })}::jsonb)
        ON CONFLICT (tenant_id, deduplication_key) DO NOTHING RETURNING id
      `;
      if (result.length) queued += 1;
    };
    for (const lead of leads) {
      const hours = lead.store_id ? hoursByStore.get(lead.store_id) ?? [] : [];
      const holidays = lead.store_id ? holidaysByStore.get(lead.store_id) ?? [] : [];
      const deadline = (minutes: number) => lead.is_international ? new Date(lead.received_at.getTime() + minutes * 60_000) : addBusinessMinutes(lead.received_at, minutes, hours, holidays);
      if (now >= deadline(3)) await enqueue(lead, lead.assigned_to, "first_touch_reminder", 3);
      if (now >= deadline(lead.first_touch_target_minutes) && !lead.sla_breached) {
        const [changed] = await transaction`
          UPDATE app.leads SET sla_breached = true, sla_breach_minutes = ${Math.max(0, Math.floor((now.getTime() - lead.sla_due_at.getTime()) / 60_000))}
          WHERE tenant_id = ${tenantId} AND id = ${lead.id} AND NOT sla_breached RETURNING id
        `;
        if (changed) await transaction`
          INSERT INTO app.lead_events (tenant_id, lead_id, event_type, actor_type, payload)
          VALUES (${tenantId}, ${lead.id}, 'sla_breached', 'system', ${JSON.stringify({ dueAt: lead.sla_due_at, detectedAt: now })}::jsonb)
        `;
      }
      if (!lead.is_international && lead.manager_escalation_minutes && now >= deadline(lead.manager_escalation_minutes)) {
        await enqueue(lead, users.find((candidate) => candidate.role === "manager" && candidate.store_id === lead.store_id)?.id, "manager_escalation", lead.manager_escalation_minutes);
      }
      if (now >= deadline(lead.owner_escalation_minutes)) await enqueue(lead, owner?.id, "owner_escalation", lead.owner_escalation_minutes);
      if (now >= deadline(lead.abandoned_minutes)) {
        await enqueue(lead, owner?.id, "lead_abandoned", lead.abandoned_minutes);
        await transaction`
          INSERT INTO app.lead_events (tenant_id, lead_id, event_type, actor_type, payload)
          SELECT ${tenantId}, ${lead.id}, 'sla_abandoned', 'system', ${JSON.stringify({ thresholdMinutes: lead.abandoned_minutes })}::jsonb
          WHERE NOT EXISTS (SELECT 1 FROM app.lead_events WHERE tenant_id = ${tenantId} AND lead_id = ${lead.id} AND event_type = 'sla_abandoned')
        `;
      }
    }
    return queued;
  });
}

export async function processDueFollowups(tenantId: string) {
  return withTenant({ tenantId, userRole: "system" }, async (transaction) => {
    const due = await transaction<{ id: string; assigned_to: string; full_name: string | null; next_action_at: Date }[]>`
      SELECT id, assigned_to, full_name, next_action_at FROM app.leads
      WHERE tenant_id = ${tenantId} AND assigned_to IS NOT NULL AND next_action_at <= clock_timestamp() AND conversation_state <> 'closed'
    `;
    for (const lead of due) await transaction`
      INSERT INTO app.notifications (tenant_id, lead_id, recipient_user_id, channel, template, deduplication_key, payload)
      VALUES (${tenantId}, ${lead.id}, ${lead.assigned_to}, 'whatsapp', 'followup_due', ${`followup-due:${lead.id}:${lead.next_action_at.toISOString()}`}, ${JSON.stringify({ leadName: lead.full_name, dueAt: lead.next_action_at })}::jsonb)
      ON CONFLICT (tenant_id, deduplication_key) DO NOTHING
    `;
    return due.length;
  });
}
