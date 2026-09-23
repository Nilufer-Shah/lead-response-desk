import { withTenant } from "@/db";

export async function queueDailyOwnerDigest(tenantId: string, metricDate: string) {
  return withTenant({ tenantId, userRole: "system" }, async (transaction) => {
    const [owner] = await transaction<{ id: string }[]>`SELECT id FROM app.users WHERE tenant_id = ${tenantId} AND role = 'owner' AND status = 'active' ORDER BY created_at LIMIT 1`;
    if (!owner) return false;
    const [metrics] = await transaction<{
      leads: number; touched: number; untouched: number; average_seconds: number | null; calls: number; connected: number; visits_booked: number; visits_done: number; won: number; revenue: string; slowest_seconds: number | null;
    }[]>`
      WITH day_leads AS (
        SELECT * FROM app.leads WHERE tenant_id = ${tenantId} AND (received_at AT TIME ZONE 'Asia/Kolkata')::date = ${metricDate}::date
      ), day_attempts AS (
        SELECT a.* FROM app.attempts a WHERE a.tenant_id = ${tenantId} AND (a.initiated_at AT TIME ZONE 'Asia/Kolkata')::date = ${metricDate}::date
      ), day_events AS (
        SELECT * FROM app.lead_events WHERE tenant_id = ${tenantId} AND (occurred_at AT TIME ZONE 'Asia/Kolkata')::date = ${metricDate}::date
      )
      SELECT
        (SELECT count(*)::integer FROM day_leads) AS leads,
        (SELECT count(*)::integer FROM day_leads WHERE first_touch_at IS NOT NULL AND first_touch_at <= sla_due_at) AS touched,
        (SELECT count(*)::integer FROM day_leads WHERE first_touch_at IS NULL) AS untouched,
        (SELECT avg(extract(epoch FROM first_touch_at - received_at))::integer FROM day_leads WHERE first_touch_at IS NOT NULL) AS average_seconds,
        (SELECT count(*)::integer FROM day_attempts WHERE channel = 'call') AS calls,
        (SELECT count(DISTINCT ae.attempt_id)::integer FROM app.attempt_events ae JOIN day_attempts a ON a.id = ae.attempt_id WHERE ae.tenant_id = ${tenantId} AND ae.event_type = 'disposition_logged' AND ae.payload ->> 'disposition' IN ('connected','interested','visit_booked')) AS connected,
        (SELECT count(*)::integer FROM day_events WHERE event_type = 'visit_booked') AS visits_booked,
        (SELECT count(*)::integer FROM day_events WHERE event_type = 'visit_done') AS visits_done,
        (SELECT count(*)::integer FROM day_events WHERE event_type = 'lead_closed' AND payload ->> 'closeReason' = 'bought') AS won,
        COALESCE((SELECT sum((payload ->> 'orderValue')::numeric) FROM day_events WHERE event_type = 'lead_closed' AND payload ->> 'closeReason' = 'bought'), 0)::text AS revenue,
        (SELECT max(extract(epoch FROM first_touch_at - received_at))::integer FROM day_leads WHERE first_touch_at IS NOT NULL) AS slowest_seconds
    `;
    const [created] = await transaction`
      INSERT INTO app.notifications (tenant_id, recipient_user_id, channel, template, deduplication_key, payload)
      VALUES (${tenantId}, ${owner.id}, 'whatsapp', 'daily_owner_digest', ${`daily-digest:${metricDate}`}, ${JSON.stringify(metrics)}::jsonb)
      ON CONFLICT (tenant_id, deduplication_key) DO NOTHING RETURNING id
    `;
    return Boolean(created);
  });
}
