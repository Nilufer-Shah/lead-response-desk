import { withTenant } from "@/db";
import type { LeadCard, QualityCase, TimelineItem } from "@/domain/read-models";
import type { SessionUser } from "@/lib/auth";
import { demoLeads, leadTimeline, qualityRows } from "@/lib/demo-data";
import { env } from "@/lib/env";

const stageLabels: Record<string, string> = { new: "New", contacted: "Contacted", qualified: "Qualified", visit_booked: "Visit booked", visited: "Visited", won: "Won", lost: "Lost" };
const qualityLabels: Record<string, string> = { unrated: "Unrated", good: "Good", invalid_number: "Invalid number", wrong_person: "Wrong person", out_of_area: "Out of area", budget_mismatch: "Budget mismatch", competitor: "Competitor", spam: "Spam", duplicate: "Duplicate" };
const eventTitles: Record<string, string> = { lead_received: "Lead received", assigned: "Lead assigned", reassigned: "Lead reassigned", stage_changed: "Stage updated", reopened: "Lead reopened", lead_closed: "Lead closed", repeat_enquiry: "Repeat enquiry", late_sync: "Late offline sync", quality_claim_approved: "Quality claim approved", quality_claim_returned: "Quality claim returned" };

function formatTime(value: Date | string) { return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function formatFollowup(stage: string, nextAction: Date | null) {
  if (stage === "new") return "Call now";
  if (!nextAction) return stage === "visit_booked" ? "Visit booked" : "No follow-up scheduled";
  return `Follow up ${new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(nextAction)}`;
}

interface LeadRow {
  id: string; full_name: string | null; phone_e164: string | null; city: string | null; ad_name: string | null; campaign_name: string | null;
  owner: string | null; sla_due_at: Date; sla_breached: boolean; stage: string; attempt_count: number; first_connect_at: Date | null;
  quality_flag: string; next_action_at: Date | null; first_touch_at: Date | null; received_at: Date; is_international: boolean; custom_fields: Record<string, unknown>;
}

function toLeadCard(row: LeadRow): LeadCard {
  const timer = Math.floor((new Date(row.sla_due_at).getTime() - Date.now()) / 1000);
  return {
    id: row.id, name: row.full_name || "Unnamed lead", phone: row.phone_e164 || "No phone", city: row.city || "City not provided",
    ad: row.ad_name || "Source details unavailable", campaign: row.campaign_name || "Unattributed", owner: row.owner || "Unassigned",
    state: row.sla_breached || timer < 0 ? "breach" : timer < 120 ? "warn" : "calm", timer,
    followup: formatFollowup(row.stage, row.next_action_at), stage: stageLabels[row.stage] || row.stage,
    attempts: row.attempt_count, connected: Boolean(row.first_connect_at), quality: qualityLabels[row.quality_flag] || row.quality_flag,
    firstResponseSeconds: row.first_touch_at ? Math.max(0, Math.round((new Date(row.first_touch_at).getTime() - new Date(row.received_at).getTime()) / 1000)) : null,
    isInternational: row.is_international, customFields: row.custom_fields || {}, receivedAt: new Date(row.received_at).toISOString(),
  };
}

const leadSelect = `
  SELECT l.id, l.full_name, l.phone_e164, l.city, l.ad_name, l.campaign_name, u.display_name AS owner,
    l.sla_due_at, l.sla_breached, l.stage::text, l.attempt_count, l.first_connect_at, l.quality_flag::text,
    l.next_action_at, l.first_touch_at, l.received_at, l.is_international, l.custom_fields
  FROM app.leads l LEFT JOIN app.users u ON u.tenant_id = l.tenant_id AND u.id = l.assigned_to
`;

export async function getLeadCards(user: SessionUser): Promise<LeadCard[]> {
  if (env().DEMO_MODE === "true") return demoLeads.filter((lead) => user.role !== "salesperson" || lead.owner === user.name);
  const rows = await withTenant(user, (transaction) => transaction.unsafe<LeadRow[]>(`${leadSelect} WHERE l.tenant_id = $1 ORDER BY CASE WHEN l.first_touch_at IS NULL THEN 0 ELSE 1 END, l.sla_due_at, l.received_at DESC LIMIT 1000`, [user.tenantId]));
  return rows.map(toLeadCard);
}

export async function getLeadDetailView(user: SessionUser, leadId: string): Promise<{ lead: LeadCard; timeline: TimelineItem[]; assignees: Array<{ id: string; name: string }> } | null> {
  if (env().DEMO_MODE === "true") {
    const lead = demoLeads.find((item) => item.id === leadId);
    return lead ? { lead, timeline: leadTimeline.map((item, index) => ({ ...item, tone: item.tone as TimelineItem["tone"], id: `demo-${index}` })), assignees: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", name: "Ashwini" }, { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5", name: "Rhea" }] } : null;
  }
  return withTenant(user, async (transaction) => {
    const rows = await transaction.unsafe<LeadRow[]>(`${leadSelect} WHERE l.tenant_id = $1 AND l.id = $2 LIMIT 1`, [user.tenantId, leadId]);
    if (!rows[0]) return null;
    const events = await transaction<{ id: string; kind: string; payload: Record<string, unknown>; occurred_at: Date; client_at: Date | null; corrected: boolean }[]>`
      WITH combined AS (
        SELECT e.id, e.event_type AS kind, e.payload, e.occurred_at, NULL::timestamptz AS client_at, false AS corrected
        FROM app.lead_events e WHERE e.tenant_id = ${user.tenantId} AND e.lead_id = ${leadId}
        UNION ALL
        SELECT n.id, 'note_added', jsonb_build_object('body', n.body), n.created_at, n.client_initiated_at, false
        FROM app.notes n WHERE n.tenant_id = ${user.tenantId} AND n.lead_id = ${leadId}
        UNION ALL
        SELECT a.id, 'attempt_started', jsonb_build_object('channel', a.channel), a.initiated_at, a.client_initiated_at, false
        FROM app.attempts a WHERE a.tenant_id = ${user.tenantId} AND a.lead_id = ${leadId}
        UNION ALL
        SELECT ae.id, ae.event_type::text, ae.payload, ae.occurred_at, NULL::timestamptz,
          ae.event_type = 'disposition_logged' AND EXISTS (
            SELECT 1 FROM app.attempt_events newer WHERE newer.tenant_id = ae.tenant_id AND newer.attempt_id = ae.attempt_id
              AND newer.event_type = 'disposition_logged' AND (newer.occurred_at, newer.id) > (ae.occurred_at, ae.id)
          )
        FROM app.attempt_events ae JOIN app.attempts a ON a.tenant_id = ae.tenant_id AND a.id = ae.attempt_id
        WHERE a.tenant_id = ${user.tenantId} AND a.lead_id = ${leadId}
      ) SELECT * FROM combined ORDER BY occurred_at DESC, id DESC LIMIT 200
    `;
    const timeline = events.map((event): TimelineItem => {
      const raw = event.payload || {};
      const disposition = String(raw.disposition ?? "").replaceAll("_", " ");
      const title = event.kind === "note_added" ? "Note added" : event.kind === "attempt_started" ? `${String(raw.channel ?? "Contact")} attempt started` : event.kind === "disposition_logged" ? `Call: ${disposition || "Outcome logged"}` : event.kind.startsWith("whatsapp_") ? event.kind.replaceAll("_", " ") : eventTitles[event.kind] || event.kind.replaceAll("_", " ");
      const detail = event.kind === "note_added" ? String(raw.body ?? "") : event.kind === "stage_changed" ? `${String(raw.fromStage ?? "")} → ${String(raw.toStage ?? "")}` : event.kind === "late_sync" ? "This action was logged more than 30 minutes after it happened." : event.corrected ? "Corrected by a later disposition" : String(raw.reason ?? raw.detail ?? "Recorded in the activity log");
      const clientDelta = event.client_at ? Math.abs(new Date(event.occurred_at).getTime() - new Date(event.client_at).getTime()) : 0;
      return { id: event.id, at: formatTime(event.occurred_at), title, detail, tone: event.kind.includes("breach") || event.kind === "late_sync" ? "breach" : event.kind.includes("delivered") || event.kind.includes("read") ? "calm" : "neutral", corrected: event.corrected, clientAt: clientDelta > 60_000 && event.client_at ? `logged offline at ${formatTime(event.client_at)}, synced ${formatTime(event.occurred_at)}` : null };
    });
    const assignees = await transaction<{ id: string; name: string }[]>`SELECT id, display_name AS name FROM app.users WHERE tenant_id=${user.tenantId} AND role='salesperson' AND status='active' ORDER BY display_name`;
    return { lead: toLeadCard(rows[0]), timeline, assignees };
  });
}

export interface DashboardData {
  leads: number; medianSeconds: number | null; withinSla: number; connected: number; visitsBooked: number; visitsDone: number; won: number; revenue: number;
  buckets: Array<{ label: string; value: number; color: string }>; waiting: LeadCard[];
  people: Array<{ name: string; leads: number; medianSeconds: number | null; attempts: number; connect: number; visits: number; won: number; breaches: number }>;
}

function median(values: number[]) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2); }

export async function getDashboardData(user: SessionUser): Promise<DashboardData> {
  const cards = await getLeadCards(user);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const periodCards = env().DEMO_MODE === "true" ? cards : cards.filter((lead) => lead.receivedAt && new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(lead.receivedAt)) === today);
  const responses = periodCards.map((lead) => lead.firstResponseSeconds).filter((value): value is number => value !== null && value !== undefined);
  const bucketDefs = [{ label: "0–5 min", max: 300, color: "var(--calm)" }, { label: "5–15 min", max: 900, color: "var(--thread)" }, { label: "15–60 min", max: 3600, color: "var(--warn)" }, { label: "1–4 hr", max: 14400, color: "#b56d38" }, { label: "4–24 hr", max: 86400, color: "#a6534d" }, { label: "Over 24 hr", max: Infinity, color: "var(--breach)" }];
  let previous = 0;
  const buckets = bucketDefs.map((bucket) => { const count = responses.filter((value) => value > previous && value <= bucket.max).length; previous = bucket.max; return { label: bucket.label, value: periodCards.length ? Math.round(count / periodCards.length * 100) : 0, color: bucket.color }; });
  buckets.push({ label: "Untouched", value: periodCards.length ? Math.round((periodCards.length - responses.length) / periodCards.length * 100) : 0, color: "#812f3e" });
  if (env().DEMO_MODE === "true") return { leads: 200, medianSeconds: 1122, withinSla: 70, connected: 78, visitsBooked: 20, visitsDone: 14, won: 7, revenue: 284000, buckets, waiting: cards.filter((item) => item.attempts === 0).slice(0, 4), people: [{ name: "Ashwini", leads: 46, medianSeconds: 1122, attempts: 1.8, connect: 31, visits: 7, won: 2, breaches: 18 }, { name: "Rhea", leads: 39, medianSeconds: 431, attempts: 2.4, connect: 44, visits: 9, won: 3, breaches: 8 }, { name: "Harsh", leads: 12, medianSeconds: 186, attempts: 3.1, connect: 58, visits: 4, won: 2, breaches: 1 }] };
  const stats = await withTenant(user, (transaction) => transaction<{ name: string; leads: number; responses: number[]; attempts: number; connected: number; visits: number; won: number; breaches: number; revenue: number }[]>`
    SELECT COALESCE(u.display_name, 'Unassigned') AS name, count(*)::int AS leads,
      array_remove(array_agg(extract(epoch FROM (l.first_touch_at-l.received_at))::int), NULL) AS responses,
      sum(l.attempt_count)::int AS attempts, count(*) FILTER (WHERE l.first_connect_at IS NOT NULL)::int AS connected,
      count(*) FILTER (WHERE l.stage IN ('visit_booked','visited','won'))::int AS visits,
      count(*) FILTER (WHERE l.stage = 'won')::int AS won, count(*) FILTER (WHERE l.sla_breached)::int AS breaches,
      COALESCE(sum(l.order_value),0)::float8 AS revenue
    FROM app.leads l LEFT JOIN app.users u ON u.tenant_id=l.tenant_id AND u.id=l.assigned_to
    WHERE l.tenant_id=${user.tenantId} AND (l.received_at AT TIME ZONE 'Asia/Kolkata')::date=(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
    GROUP BY u.display_name ORDER BY leads DESC
  `);
  return { leads: periodCards.length, medianSeconds: median(responses), withinSla: responses.filter((value) => value <= 300).length, connected: periodCards.filter((item) => item.connected).length, visitsBooked: periodCards.filter((item) => ["Visit booked", "Visited", "Won"].includes(item.stage)).length, visitsDone: periodCards.filter((item) => ["Visited", "Won"].includes(item.stage)).length, won: stats.reduce((sum, row) => sum + row.won, 0), revenue: stats.reduce((sum, row) => sum + Number(row.revenue), 0), buckets, waiting: cards.filter((item) => item.attempts === 0).slice(0, 4), people: stats.map((row) => ({ name: row.name, leads: row.leads, medianSeconds: median(row.responses || []), attempts: row.leads ? Number((row.attempts / row.leads).toFixed(1)) : 0, connect: row.leads ? Math.round(row.connected / row.leads * 100) : 0, visits: row.visits, won: row.won, breaches: row.breaches })) };
}

export async function getQualityCases(user: SessionUser): Promise<QualityCase[]> {
  if (env().DEMO_MODE === "true") return qualityRows.map((row, index) => ({ id: demoLeads[index]?.id ?? `demo-${index}`, ...row, status: row.status as QualityCase["status"] }));
  return withTenant(user, async (transaction) => {
    const rows = await transaction<{ id: string; full_name: string | null; quality_flag: string; close_reason: string | null; attempt_count: number; days: number; whatsapp: string; note: string; gate: { allowed: boolean }; decision: string | null }[]>`
      SELECT l.id, l.full_name, l.quality_flag::text, l.close_reason::text, l.attempt_count,
        COALESCE((SELECT count(DISTINCT (a.initiated_at AT TIME ZONE 'Asia/Kolkata')::date)::int FROM app.attempts a WHERE a.tenant_id=l.tenant_id AND a.lead_id=l.id),0) AS days,
        COALESCE((SELECT max(ae.event_type::text) FROM app.attempts a JOIN app.attempt_events ae ON ae.tenant_id=a.tenant_id AND ae.attempt_id=a.id WHERE a.tenant_id=l.tenant_id AND a.lead_id=l.id AND ae.event_type IN ('whatsapp_sent','whatsapp_delivered','whatsapp_read')), 'None') AS whatsapp,
        COALESCE((SELECT n.body FROM app.notes n WHERE n.tenant_id=l.tenant_id AND n.lead_id=l.id ORDER BY n.created_at DESC LIMIT 1), 'No note') AS note,
        app.close_gate_status(l.tenant_id,l.id,l.close_reason,l.quality_flag,(SELECT n.body FROM app.notes n WHERE n.tenant_id=l.tenant_id AND n.lead_id=l.id ORDER BY n.created_at DESC LIMIT 1),NULL) AS gate,
        (SELECT e.event_type FROM app.lead_events e WHERE e.tenant_id=l.tenant_id AND e.lead_id=l.id AND e.event_type IN ('quality_claim_approved','quality_claim_returned') ORDER BY e.occurred_at DESC LIMIT 1) AS decision
      FROM app.leads l WHERE l.tenant_id=${user.tenantId} AND (l.quality_flag <> 'unrated' OR l.close_reason IS NOT NULL)
      ORDER BY l.updated_at DESC LIMIT 200
    `;
    return rows.map((row) => ({ id: row.id, name: row.full_name || "Unnamed lead", flag: qualityLabels[row.quality_flag] || (row.close_reason ?? "Review"), attempts: `${row.attempt_count} attempt${row.attempt_count === 1 ? "" : "s"}`, days: `${row.days} day${row.days === 1 ? "" : "s"}`, whatsapp: row.whatsapp.replaceAll("_", " "), note: row.note, status: row.decision === "quality_claim_approved" ? "Approved" : row.decision === "quality_claim_returned" ? "Returned" : row.gate.allowed ? "Ready for review" : "Gate failed" }));
  });
}

export interface CampaignSummary { name: string; leads: number; medianSeconds: number | null; connect: number; visits: number; spend: number | null; }

export async function getCampaignSummaries(user: SessionUser): Promise<CampaignSummary[]> {
  if (env().DEMO_MODE === "true") return [
    { name: "Festive Silk Collection", leads: 76, medianSeconds: 982, connect: 43, visits: 12, spend: null },
    { name: "Wedding Edit", leads: 64, medianSeconds: 1268, connect: 38, visits: 7, spend: null },
    { name: "International Bridal", leads: 18, medianSeconds: 252, connect: 61, visits: 4, spend: null },
    { name: "Heritage Weaves", leads: 42, medianSeconds: 1191, connect: 29, visits: 3, spend: null },
  ];
  const rows = await withTenant(user, (transaction) => transaction<{ name: string; leads: number; responses: number[]; connected: number; visits: number; spend: number | null }[]>`
    SELECT COALESCE(l.campaign_name,'Unattributed') AS name, count(*)::int AS leads,
      array_remove(array_agg(extract(epoch FROM (l.first_touch_at-l.received_at))::int),NULL) AS responses,
      count(*) FILTER (WHERE l.first_connect_at IS NOT NULL)::int AS connected,
      count(*) FILTER (WHERE l.stage IN ('visit_booked','visited','won'))::int AS visits,
      max(c.spend_inr)::float8 AS spend
    FROM app.leads l LEFT JOIN app.meta_ad_cache c ON c.tenant_id=l.tenant_id AND c.campaign_id=l.campaign_id
    WHERE l.tenant_id=${user.tenantId} GROUP BY l.campaign_name ORDER BY leads DESC
  `);
  return rows.map((row) => ({ name: row.name, leads: row.leads, medianSeconds: median(row.responses || []), connect: row.leads ? Math.round(row.connected / row.leads * 100) : 0, visits: row.visits, spend: row.spend == null ? null : Number(row.spend) }));
}

export interface ReportHistoryItem { id: string; period: string; kind: string; version: number; status: string; generated: string; }

export async function getReportHistory(user: SessionUser): Promise<ReportHistoryItem[]> {
  if (env().DEMO_MODE === "true") return [
    { id: "demo-current", period: "7–13 September", kind: "Weekly owner report", version: 1, status: "Ready", generated: "Today, 9:58 AM" },
    { id: "demo-prior", period: "31 August–6 September", kind: "Weekly owner report", version: 1, status: "Sent", generated: "7 Sep, 10:00 AM" },
  ];
  return withTenant(user, async (transaction) => {
    const rows = await transaction<{ id: string; period_start: string; period_end: string; kind: string; version: number; status: string; generated_at: Date | null; created_at: Date }[]>`
      SELECT id, period_start::text, period_end::text, kind, version, status, generated_at, created_at FROM app.reports
      WHERE tenant_id=${user.tenantId} ORDER BY period_start DESC, version DESC LIMIT 50
    `;
    return rows.map((row) => ({ id: row.id, period: `${row.period_start} – ${row.period_end}`, kind: row.kind.replaceAll("_", " "), version: row.version, status: row.status, generated: new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(row.generated_at || row.created_at) }));
  });
}

export interface DailyMetricHistory { date: string; leads: number; withinSla: number; medianSeconds: number | null; connected: number; visits: number; won: number; revenue: number; }

export async function getDailyMetricHistory(user: SessionUser): Promise<DailyMetricHistory[]> {
  if (env().DEMO_MODE === "true") return [
    { date: "2026-09-11", leads: 15, withinSla: 7, medianSeconds: 620, connected: 6, visits: 3, won: 1, revenue: 42000 },
    { date: "2026-09-12", leads: 18, withinSla: 9, medianSeconds: 544, connected: 8, visits: 4, won: 1, revenue: 38000 },
  ];
  return withTenant(user, async (transaction) => {
    const rows = await transaction<{ metric_date: string; leads_received: number; touched_within_sla: number; median_first_response_seconds: number | null; connected: number; visits_booked: number; won: number; revenue: string }[]>`
      SELECT DISTINCT ON (metric_date) metric_date::text, leads_received, touched_within_sla, median_first_response_seconds, connected, visits_booked, won, revenue::text
      FROM app.daily_metrics WHERE tenant_id=${user.tenantId} AND dimension='tenant'
        AND metric_date < (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
      ORDER BY metric_date DESC, snapshot_version DESC LIMIT 30
    `;
    return rows.map((row) => ({ date: row.metric_date, leads: row.leads_received, withinSla: row.touched_within_sla, medianSeconds: row.median_first_response_seconds, connected: row.connected, visits: row.visits_booked, won: row.won, revenue: Number(row.revenue) }));
  });
}
