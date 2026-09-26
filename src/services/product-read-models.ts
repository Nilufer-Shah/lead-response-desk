import { withTenant } from "@/db";
import type { SessionUser } from "@/lib/auth";

export interface QueueLead {
  id: string; name: string; phone: string; city: string; campaign: string; ad: string; source: string; owner: string;
  stage: string; arrivedAt: string; elapsedBusinessMinutes: number; followupId?: string; followupDay?: number; followupStatus?: string;
}

export interface TodayQueueData {
  newLeads: QueueLead[]; dueFollowups: QueueLead[]; missedFollowups: QueueLead[];
  storeOpen: boolean; refreshedAt: string;
}

interface QueueRow {
  id: string; full_name: string | null; phone_e164: string | null; city: string | null; campaign_name: string | null; ad_name: string | null;
  source: string; owner: string | null; stage: string; received_at: Date; elapsed_minutes: number; followup_id: string | null;
  day_number: number | null; followup_status: string | null;
}

function queueLead(row: QueueRow): QueueLead {
  return {
    id: row.id, name: row.full_name || "Unnamed lead", phone: row.phone_e164 || "No phone", city: row.city || "City not provided",
    campaign: row.campaign_name || "Unattributed", ad: row.ad_name || "Source details unavailable", source: row.source,
    owner: row.owner || "Unassigned", stage: row.stage, arrivedAt: new Date(row.received_at).toISOString(),
    elapsedBusinessMinutes: Number(row.elapsed_minutes ?? 0), followupId: row.followup_id ?? undefined,
    followupDay: row.day_number ?? undefined, followupStatus: row.followup_status ?? undefined,
  };
}

export async function getTodayQueue(user: SessionUser): Promise<TodayQueueData> {
  return withTenant(user, async (transaction) => {
    const newRows = await transaction<QueueRow[]>`
      SELECT l.id,l.full_name,l.phone_e164,l.city,l.campaign_name,l.ad_name,l.source::text,u.display_name AS owner,l.stage::text,l.received_at,
        app.business_minutes_between(l.tenant_id,l.store_id,l.received_at,clock_timestamp()) AS elapsed_minutes,
        NULL::uuid AS followup_id,NULL::integer AS day_number,NULL::text AS followup_status
      FROM app.leads l
      LEFT JOIN app.users u ON u.tenant_id=l.tenant_id AND u.id=l.assigned_to
      WHERE l.tenant_id=${user.tenantId} AND l.stage='new'
      ORDER BY l.received_at ASC
    `;
    const followupRows = await transaction<QueueRow[]>`
      SELECT l.id,l.full_name,l.phone_e164,l.city,l.campaign_name,l.ad_name,l.source::text,u.display_name AS owner,l.stage::text,l.received_at,
        app.business_minutes_between(l.tenant_id,l.store_id,l.received_at,COALESCE(l.first_contacted_at,clock_timestamp())) AS elapsed_minutes,
        f.id AS followup_id,f.day_number,f.status::text AS followup_status
      FROM app.lead_followups f
      JOIN app.leads l ON l.tenant_id=f.tenant_id AND l.id=f.lead_id
      LEFT JOIN app.users u ON u.tenant_id=l.tenant_id AND u.id=l.assigned_to
      WHERE f.tenant_id=${user.tenantId} AND l.stage NOT IN ('won','dead','bad','dormant')
        AND f.created_at>=l.received_at
        AND ((f.status='pending' AND f.due_date=(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date) OR f.status='missed')
      ORDER BY f.due_date,f.day_number,l.received_at
    `;
    const [open] = await transaction<{ open: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM app.business_hours bh
        JOIN app.stores s ON s.tenant_id=bh.tenant_id AND s.id=bh.store_id AND s.is_default AND s.active
        LEFT JOIN app.store_holidays sh ON sh.tenant_id=s.tenant_id AND sh.store_id=s.id AND sh.holiday_date=(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
        WHERE bh.tenant_id=${user.tenantId} AND bh.enabled
          AND bh.weekday=extract(dow FROM (clock_timestamp() AT TIME ZONE 'Asia/Kolkata'))::integer
          AND NOT COALESCE(sh.closed,false)
          AND (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::time>=COALESCE(sh.opens_at,bh.opens_at)
          AND (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::time<COALESCE(sh.closes_at,bh.closes_at)
      ) AS open
    `;
    return {
      newLeads: newRows.map(queueLead),
      dueFollowups: followupRows.filter((row) => row.followup_status === "pending").map(queueLead),
      missedFollowups: followupRows.filter((row) => row.followup_status === "missed").map(queueLead),
      storeOpen: open?.open ?? false, refreshedAt: new Date().toISOString(),
    };
  });
}

export interface LeadListItem extends QueueLead { attempts: number; firstResponseMinutes: number | null; outcomeReason: string | null; }

export async function getLeadList(user: SessionUser): Promise<LeadListItem[]> {
  return withTenant(user, async (transaction) => {
    const rows = await transaction<(QueueRow & { attempt_count: number; first_response_minutes: number | null; outcome_reason: string | null })[]>`
      SELECT l.id,l.full_name,l.phone_e164,l.city,l.campaign_name,l.ad_name,l.source::text,u.display_name AS owner,l.stage::text,l.received_at,
        app.business_minutes_between(l.tenant_id,l.store_id,l.received_at,COALESCE(l.first_contacted_at,clock_timestamp())) AS elapsed_minutes,
        NULL::uuid AS followup_id,NULL::integer AS day_number,NULL::text AS followup_status,l.attempt_count,l.first_response_minutes,l.outcome_reason
      FROM app.leads l LEFT JOIN app.users u ON u.tenant_id=l.tenant_id AND u.id=l.assigned_to
      WHERE l.tenant_id=${user.tenantId} ORDER BY l.received_at DESC LIMIT 1000
    `;
    return rows.map((row) => ({ ...queueLead(row), attempts: row.attempt_count, firstResponseMinutes: row.first_response_minutes, outcomeReason: row.outcome_reason }));
  });
}

export interface LeadTimelineItem { id: string; at: string; title: string; detail: string; tone: "calm" | "neutral" | "breach"; }
export interface LeadDetailData {
  lead: LeadListItem;
  timeline: LeadTimelineItem[];
  followups: Array<{ id: string; dayNumber: number; dueDate: string; status: string; answer: string | null; note: string | null }>;
  assignees: Array<{ id: string; name: string }>;
  gate: { attempts: number; distinctDays: number };
}

const time = (value: Date) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export async function getLeadDetail(user: SessionUser, leadId: string): Promise<LeadDetailData | null> {
  return withTenant(user, async (transaction) => {
    const [lead] = await transaction<(QueueRow & { attempt_count: number; first_response_minutes: number | null; outcome_reason: string | null })[]>`
      SELECT l.id,l.full_name,l.phone_e164,l.city,l.campaign_name,l.ad_name,l.source::text,u.display_name AS owner,l.stage::text,l.received_at,
        app.business_minutes_between(l.tenant_id,l.store_id,l.received_at,COALESCE(l.first_contacted_at,clock_timestamp())) AS elapsed_minutes,
        NULL::uuid AS followup_id,NULL::integer AS day_number,NULL::text AS followup_status,l.attempt_count,l.first_response_minutes,l.outcome_reason
      FROM app.leads l LEFT JOIN app.users u ON u.tenant_id=l.tenant_id AND u.id=l.assigned_to
      WHERE l.tenant_id=${user.tenantId} AND l.id=${leadId}
    `;
    if (!lead) return null;
    const events = await transaction<{ id: string; kind: string; payload: Record<string, unknown>; occurred_at: Date }[]>`
      WITH events AS (
        SELECT id,event_type AS kind,payload,occurred_at FROM app.lead_events WHERE tenant_id=${user.tenantId} AND lead_id=${leadId}
        UNION ALL
        SELECT id,'note_added',jsonb_build_object('body',body),created_at FROM app.notes WHERE tenant_id=${user.tenantId} AND lead_id=${leadId}
        UNION ALL
        SELECT id,'attempt_started',jsonb_build_object('channel',channel),initiated_at FROM app.attempts WHERE tenant_id=${user.tenantId} AND lead_id=${leadId}
      ) SELECT * FROM events ORDER BY occurred_at DESC,id DESC LIMIT 250
    `;
    const timeline = events.map((event): LeadTimelineItem => {
      const payload = event.payload ?? {};
      const titles: Record<string,string> = {
        lead_received: "Lead received", attempt_started: `${String(payload.channel ?? "Contact")} tapped`, note_added: "Note added",
        stage_changed: `Stage changed to ${String(payload.toStage ?? "").replaceAll("_"," ")}`,
        followup_answered: `Follow-up day ${String(payload.dayNumber ?? "")} · ${String(payload.answer ?? "")}`,
        followup_missed: `Follow-up day ${String(payload.dayNumber ?? "")} missed`, outcome_recorded: `Marked ${String(payload.outcome ?? "closed")}`,
        repeat_enquiry: "Repeat enquiry", repeat_enquiry_reactivated: "Dormant lead reactivated", repeat_enquiry_new_lead: "New enquiry created",
        lead_reassigned: "Lead reassigned",
      };
      const detail = event.kind === "note_added" ? String(payload.body ?? "")
        : event.kind === "followup_answered" ? String(payload.note ?? "")
        : event.kind === "stage_changed" ? `${String(payload.fromStage ?? "").replaceAll("_"," ")} → ${String(payload.toStage ?? "").replaceAll("_"," ")}`
        : String(payload.reason ?? payload.source ?? "Recorded by the system");
      return { id: event.id, at: time(event.occurred_at), title: titles[event.kind] ?? event.kind.replaceAll("_"," "), detail, tone: event.kind.includes("missed") ? "breach" : event.kind.includes("answered") || event.kind.includes("received") ? "calm" : "neutral" };
    });
    const followups = await transaction<{ id: string; day_number: number; due_date: string; status: string; answer: string | null; note: string | null }[]>`
      SELECT id,day_number,due_date::text,status::text,answer::text,note FROM app.lead_followups
      WHERE tenant_id=${user.tenantId} AND lead_id=${leadId} AND created_at>=${lead.received_at}
      ORDER BY day_number
    `;
    const assignees = await transaction<{ id: string; name: string }[]>`
      SELECT id,display_name AS name FROM app.users
      WHERE tenant_id=${user.tenantId} AND status='active' AND role IN ('salesperson','owner')
      ORDER BY CASE role WHEN 'salesperson' THEN 0 ELSE 1 END,display_name
    `;
    const [gate] = await transaction<{ attempts: number; distinct_days: number }[]>`
      SELECT count(*)::int AS attempts,count(DISTINCT (initiated_at AT TIME ZONE 'Asia/Kolkata')::date)::int AS distinct_days
      FROM app.attempts WHERE tenant_id=${user.tenantId} AND lead_id=${leadId}
    `;
    return { lead: { ...queueLead(lead), attempts: lead.attempt_count, firstResponseMinutes: lead.first_response_minutes, outcomeReason: lead.outcome_reason }, timeline, followups: followups.map((item) => ({ id: item.id, dayNumber: item.day_number, dueDate: item.due_date, status: item.status, answer: item.answer, note: item.note })), assignees, gate: { attempts: gate?.attempts ?? 0, distinctDays: gate?.distinct_days ?? 0 } };
  });
}

export type DashboardPeriod = "today" | "7" | "30";
export interface PersonMetrics {
  id: string; name: string; assigned: number; avgResponseMinutes: number | null; withinFivePercent: number; untouched: number;
  followupsDue: number; followupsDone: number; followupsMissed: number; dormant: number; won: number; dead: number; bad: number;
  reasons: Record<string, number>;
}
export interface DashboardData {
  period: DashboardPeriod; live: { untouched: number; oldestMinutes: number | null; oldestAssignee: string | null; missedToday: number };
  people: PersonMetrics[]; totals: PersonMetrics; sources: { meta: number; sheet: number; other: number };
}

export async function getProductDashboard(user: SessionUser, period: DashboardPeriod): Promise<DashboardData> {
  const days = period === "today" ? 1 : period === "7" ? 7 : 30;
  return withTenant(user, async (transaction) => {
    const [live] = await transaction<{ untouched: number; oldest_minutes: number | null; oldest_assignee: string | null; missed_today: number }[]>`
      SELECT
        count(*) FILTER (WHERE l.stage='new')::int AS untouched,
        max(app.business_minutes_between(l.tenant_id,l.store_id,l.received_at,clock_timestamp())) FILTER (WHERE l.stage='new')::int AS oldest_minutes,
        (SELECT u.display_name FROM app.leads ol LEFT JOIN app.users u ON u.tenant_id=ol.tenant_id AND u.id=ol.assigned_to WHERE ol.tenant_id=${user.tenantId} AND ol.stage='new' ORDER BY ol.received_at LIMIT 1) AS oldest_assignee,
        (SELECT count(*)::int FROM app.lead_followups f JOIN app.leads fl ON fl.tenant_id=f.tenant_id AND fl.id=f.lead_id WHERE f.tenant_id=${user.tenantId} AND f.status='missed' AND f.due_date=(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date) AS missed_today
      FROM app.leads l WHERE l.tenant_id=${user.tenantId}
    `;
    const people = await transaction<{
      id: string; name: string; assigned: number; avg_response: number | null; within_five: number; touched: number; untouched: number;
      followups_due: number; followups_done: number; followups_missed: number; dormant: number; won: number; dead: number; bad: number; reasons: Record<string, number>;
    }[]>`
      WITH bounds AS (
        SELECT ((clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date - ${days - 1}::int) AS start_date,
          (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date AS end_date
      ), staff AS (
        SELECT staff_user.id,staff_user.display_name FROM app.users staff_user
        WHERE staff_user.tenant_id=${user.tenantId} AND staff_user.role IN ('salesperson','owner')
          AND (staff_user.role='salesperson' OR EXISTS (SELECT 1 FROM app.leads owned WHERE owned.tenant_id=staff_user.tenant_id AND owned.assigned_to=staff_user.id))
          AND (${user.role}::text<>'salesperson' OR staff_user.id=${user.id})
      )
      SELECT s.id,s.display_name AS name,
        count(l.id) FILTER (WHERE (l.received_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN b.start_date AND b.end_date)::int AS assigned,
        round(avg(l.first_response_minutes) FILTER (WHERE (l.received_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN b.start_date AND b.end_date))::int AS avg_response,
        count(l.id) FILTER (WHERE (l.received_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN b.start_date AND b.end_date AND l.first_response_minutes<=5)::int AS within_five,
        count(l.id) FILTER (WHERE (l.received_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN b.start_date AND b.end_date AND l.first_response_minutes IS NOT NULL)::int AS touched,
        count(l.id) FILTER (WHERE (l.received_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN b.start_date AND b.end_date AND l.first_contacted_at IS NULL)::int AS untouched,
        (SELECT count(*)::int FROM app.lead_followups f WHERE f.tenant_id=${user.tenantId} AND f.assigned_to=s.id AND f.due_date BETWEEN b.start_date AND b.end_date AND f.status<>'cancelled') AS followups_due,
        (SELECT count(*)::int FROM app.lead_followups f WHERE f.tenant_id=${user.tenantId} AND f.assigned_to=s.id AND f.due_date BETWEEN b.start_date AND b.end_date AND f.status='done') AS followups_done,
        (SELECT count(*)::int FROM app.lead_followups f WHERE f.tenant_id=${user.tenantId} AND f.assigned_to=s.id AND f.due_date BETWEEN b.start_date AND b.end_date AND f.status='missed') AS followups_missed,
        count(l.id) FILTER (WHERE l.stage='dormant' AND (l.updated_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN b.start_date AND b.end_date)::int AS dormant,
        count(l.id) FILTER (WHERE l.stage='won' AND (l.closed_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN b.start_date AND b.end_date)::int AS won,
        count(l.id) FILTER (WHERE l.stage='dead' AND (l.closed_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN b.start_date AND b.end_date)::int AS dead,
        count(l.id) FILTER (WHERE l.stage='bad' AND (l.closed_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN b.start_date AND b.end_date)::int AS bad,
        COALESCE((SELECT jsonb_object_agg(reason,total) FROM (SELECT outcome_reason AS reason,count(*)::int AS total FROM app.leads r WHERE r.tenant_id=${user.tenantId} AND r.assigned_to=s.id AND r.stage IN ('dead','bad') AND (r.closed_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN b.start_date AND b.end_date GROUP BY outcome_reason) reasons),'{}'::jsonb) AS reasons
      FROM staff s CROSS JOIN bounds b
      LEFT JOIN app.leads l ON l.tenant_id=${user.tenantId} AND l.assigned_to=s.id
      GROUP BY s.id,s.display_name,b.start_date,b.end_date ORDER BY s.display_name
    `;
    const normalized = people.map((row): PersonMetrics => ({
      id: row.id, name: row.name, assigned: row.assigned, avgResponseMinutes: row.avg_response,
      withinFivePercent: row.touched ? Math.round(row.within_five / row.touched * 100) : 0, untouched: row.untouched,
      followupsDue: row.followups_due, followupsDone: row.followups_done, followupsMissed: row.followups_missed,
      dormant: row.dormant, won: row.won, dead: row.dead, bad: row.bad, reasons: row.reasons ?? {},
    }));
    const totals: PersonMetrics = normalized.reduce((sum, row) => ({
      ...sum, assigned: sum.assigned + row.assigned, untouched: sum.untouched + row.untouched,
      followupsDue: sum.followupsDue + row.followupsDue, followupsDone: sum.followupsDone + row.followupsDone,
      followupsMissed: sum.followupsMissed + row.followupsMissed, dormant: sum.dormant + row.dormant,
      won: sum.won + row.won, dead: sum.dead + row.dead, bad: sum.bad + row.bad,
      reasons: Object.entries(row.reasons).reduce((acc,[key,value]) => ({ ...acc,[key]:(acc[key] ?? 0)+Number(value) }),sum.reasons),
    }), { id: "total", name: "Team total", assigned: 0, avgResponseMinutes: null, withinFivePercent: 0, untouched: 0, followupsDue: 0, followupsDone: 0, followupsMissed: 0, dormant: 0, won: 0, dead: 0, bad: 0, reasons: {} });
    const touchedRows = people.filter((row) => row.avg_response !== null && row.touched > 0);
    const touched = people.reduce((sum,row) => sum + row.touched,0);
    totals.avgResponseMinutes = touchedRows.length ? Math.round(touchedRows.reduce((sum,row) => sum + (row.avg_response ?? 0) * row.touched,0) / touchedRows.reduce((sum,row) => sum + row.touched,0)) : null;
    totals.withinFivePercent = touched ? Math.round(people.reduce((sum,row) => sum + row.within_five,0) / touched * 100) : 0;
    const [sources] = await transaction<{ meta: number; sheet: number; other: number }[]>`
      WITH bounds AS (SELECT ((clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date-${days - 1}::int) start_date,(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date end_date)
      SELECT count(*) FILTER (WHERE source='meta_lead_form')::int AS meta,count(*) FILTER (WHERE source='csv_import')::int AS sheet,
        count(*) FILTER (WHERE source NOT IN ('meta_lead_form','csv_import'))::int AS other
      FROM app.leads,bounds WHERE tenant_id=${user.tenantId} AND (received_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN start_date AND end_date
    `;
    return { period, live: { untouched: live?.untouched ?? 0, oldestMinutes: live?.oldest_minutes ?? null, oldestAssignee: live?.oldest_assignee ?? null, missedToday: live?.missed_today ?? 0 }, people: normalized, totals, sources: sources ?? { meta: 0, sheet: 0, other: 0 } };
  });
}
