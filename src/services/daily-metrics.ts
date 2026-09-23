import { withTenant } from "@/db";

type Dimension = { dimension: "tenant" | "salesperson" | "campaign"; salespersonId: string | null; campaignId: string | null };

export async function snapshotDailyMetrics(tenantId: string, metricDate: string, revisionReason?: string) {
  return withTenant({ tenantId, userRole: "system" }, async (transaction) => {
    const dimensions: Dimension[] = [{ dimension: "tenant", salespersonId: null, campaignId: null }];
    const salespeople = await transaction<{ id: string }[]>`SELECT id FROM app.users WHERE tenant_id = ${tenantId} AND role = 'salesperson'`;
    dimensions.push(...salespeople.map((person) => ({ dimension: "salesperson" as const, salespersonId: person.id, campaignId: null })));
    const campaigns = await transaction<{ campaign_id: string }[]>`
      SELECT DISTINCT campaign_id FROM app.leads
      WHERE tenant_id = ${tenantId} AND campaign_id IS NOT NULL
        AND (received_at AT TIME ZONE 'Asia/Kolkata')::date = ${metricDate}::date
    `;
    dimensions.push(...campaigns.map((campaign) => ({ dimension: "campaign" as const, salespersonId: null, campaignId: campaign.campaign_id })));

    let written = 0;
    for (const dimension of dimensions) {
      const [existing] = await transaction<{ version: number }[]>`
        SELECT max(snapshot_version)::integer AS version
        FROM app.daily_metrics
        WHERE tenant_id = ${tenantId} AND metric_date = ${metricDate}::date AND dimension = ${dimension.dimension}
          AND salesperson_id IS NOT DISTINCT FROM ${dimension.salespersonId}
          AND campaign_id IS NOT DISTINCT FROM ${dimension.campaignId}
      `;
      if ((existing?.version ?? 0) > 0 && !revisionReason) continue;
      const version = (existing?.version ?? 0) + 1;
      const [metrics] = await transaction<{
        leads_received: number; leads_touched: number; touched_within_sla: number; never_touched: number;
        median_first_response_seconds: number | null; attempts: number; connected: number;
        visits_booked: number; visits_done: number; won: number; revenue: string; quality_flags: number;
      }[]>`
        WITH scoped_leads AS (
          SELECT l.* FROM app.leads l
          WHERE l.tenant_id = ${tenantId}
            AND (${dimension.dimension} <> 'salesperson' OR l.assigned_to = ${dimension.salespersonId})
            AND (${dimension.dimension} <> 'campaign' OR l.campaign_id = ${dimension.campaignId})
        ), received AS (
          SELECT * FROM scoped_leads WHERE (received_at AT TIME ZONE 'Asia/Kolkata')::date = ${metricDate}::date
        ), day_attempts AS (
          SELECT a.* FROM app.attempts a JOIN scoped_leads l ON l.id = a.lead_id
          WHERE a.tenant_id = ${tenantId} AND (a.initiated_at AT TIME ZONE 'Asia/Kolkata')::date = ${metricDate}::date
            AND (${dimension.dimension} <> 'salesperson' OR a.user_id = ${dimension.salespersonId})
        ), connected_attempts AS (
          SELECT count(DISTINCT ae.attempt_id)::integer AS count
          FROM app.attempt_events ae JOIN day_attempts a ON a.id = ae.attempt_id
          WHERE ae.tenant_id = ${tenantId} AND ae.event_type = 'disposition_logged'
            AND ae.payload ->> 'disposition' IN ('connected', 'interested', 'visit_booked')
        ), day_events AS (
          SELECT e.* FROM app.lead_events e JOIN scoped_leads l ON l.id = e.lead_id
          WHERE e.tenant_id = ${tenantId} AND (e.occurred_at AT TIME ZONE 'Asia/Kolkata')::date = ${metricDate}::date
        )
        SELECT
          count(*)::integer AS leads_received,
          count(*) FILTER (WHERE first_touch_at IS NOT NULL)::integer AS leads_touched,
          count(*) FILTER (WHERE first_touch_at IS NOT NULL AND first_touch_at <= sla_due_at)::integer AS touched_within_sla,
          count(*) FILTER (WHERE first_touch_at IS NULL)::integer AS never_touched,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_touch_at - received_at))
            FILTER (WHERE first_touch_at IS NOT NULL)::integer AS median_first_response_seconds,
          (SELECT count(*)::integer FROM day_attempts) AS attempts,
          (SELECT count FROM connected_attempts) AS connected,
          (SELECT count(*)::integer FROM day_events WHERE event_type = 'visit_booked') AS visits_booked,
          (SELECT count(*)::integer FROM day_events WHERE event_type = 'visit_done') AS visits_done,
          (SELECT count(*)::integer FROM day_events WHERE event_type = 'lead_closed' AND payload ->> 'closeReason' = 'bought') AS won,
          COALESCE((SELECT sum((payload ->> 'orderValue')::numeric) FROM day_events WHERE event_type = 'lead_closed' AND payload ->> 'closeReason' = 'bought'), 0)::text AS revenue,
          count(*) FILTER (WHERE quality_flag <> 'unrated')::integer AS quality_flags
        FROM received
      `;
      const [previous] = existing?.version ? await transaction<{ id: string }[]>`
        SELECT id FROM app.daily_metrics
        WHERE tenant_id = ${tenantId} AND metric_date = ${metricDate}::date AND dimension = ${dimension.dimension}
          AND salesperson_id IS NOT DISTINCT FROM ${dimension.salespersonId}
          AND campaign_id IS NOT DISTINCT FROM ${dimension.campaignId}
        ORDER BY snapshot_version DESC LIMIT 1
      ` : [];
      await transaction`
        INSERT INTO app.daily_metrics (
          tenant_id, metric_date, dimension, salesperson_id, campaign_id, snapshot_version,
          supersedes_id, revision_reason, event_watermark, leads_received, leads_touched,
          touched_within_sla, never_touched, median_first_response_seconds, attempts, connected,
          visits_booked, visits_done, won, revenue, quality_flags
        ) VALUES (
          ${tenantId}, ${metricDate}::date, ${dimension.dimension}, ${dimension.salespersonId}, ${dimension.campaignId}, ${version},
          ${previous?.id ?? null}, ${revisionReason ?? null}, clock_timestamp(), ${metrics.leads_received}, ${metrics.leads_touched},
          ${metrics.touched_within_sla}, ${metrics.never_touched}, ${metrics.median_first_response_seconds}, ${metrics.attempts}, ${metrics.connected},
          ${metrics.visits_booked}, ${metrics.visits_done}, ${metrics.won}, ${metrics.revenue}, ${metrics.quality_flags}
        )
      `;
      written += 1;
    }
    return written;
  });
}
