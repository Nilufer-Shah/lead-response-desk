import { withTenant } from "@/db";

export async function processFollowupCadence(tenantId: string) {
  return withTenant({ tenantId, userRole: "system" }, async (transaction) => {
    const dueLeads = await transaction<{ id: string }[]>`
      UPDATE app.leads l SET stage='follow_up'
      WHERE l.tenant_id=${tenantId} AND l.stage='contacted'
        AND EXISTS (
          SELECT 1 FROM app.lead_followups f
          WHERE f.tenant_id=l.tenant_id AND f.lead_id=l.id AND f.status='pending'
            AND f.created_at>=l.received_at
            AND f.due_date<=(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
        )
      RETURNING l.id
    `;

    const missed = await transaction<{ id: string; lead_id: string; day_number: number }[]>`
      WITH due AS (
        SELECT f.id
        FROM app.lead_followups f
        JOIN app.leads l ON l.tenant_id=f.tenant_id AND l.id=f.lead_id
        JOIN app.business_hours bh ON bh.tenant_id=l.tenant_id AND bh.store_id=l.store_id
          AND bh.weekday=extract(dow FROM f.due_date)::integer
        LEFT JOIN app.store_holidays sh ON sh.tenant_id=l.tenant_id AND sh.store_id=l.store_id AND sh.holiday_date=f.due_date
        WHERE f.tenant_id=${tenantId} AND f.status='pending' AND f.created_at>=l.received_at
          AND (
            f.due_date<(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
            OR (
              f.due_date=(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
              AND (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::time>=COALESCE(sh.closes_at,bh.closes_at)
            )
          )
      )
      UPDATE app.lead_followups f SET status='missed'
      FROM due WHERE f.id=due.id
      RETURNING f.id,f.lead_id,f.day_number
    `;
    for (const item of missed) await transaction`
      INSERT INTO app.lead_events (tenant_id,lead_id,event_type,actor_type,payload)
      VALUES (${tenantId},${item.lead_id},'followup_missed','system',${transaction.json({ followupId: item.id, dayNumber: item.day_number })})
    `;

    const dormant = await transaction<{ id: string }[]>`
      UPDATE app.leads l SET stage='dormant',conversation_state='waiting_on_us',next_action_at=NULL
      WHERE l.tenant_id=${tenantId} AND l.stage IN ('contacted','follow_up')
        AND EXISTS (
          SELECT 1 FROM app.lead_followups f
          WHERE f.tenant_id=l.tenant_id AND f.lead_id=l.id AND f.created_at>=l.received_at
          GROUP BY f.lead_id
          HAVING max(f.day_number)>=(SELECT followup_days FROM app.tenants WHERE tenant_id=l.tenant_id)
            AND count(*) FILTER (WHERE f.status='pending')=0
        )
      RETURNING l.id
    `;
    return { due: dueLeads.length, missed: missed.length, dormant: dormant.length };
  });
}
