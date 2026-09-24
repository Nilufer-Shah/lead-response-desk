import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createFixture, insertLead, sessionFor, sql, type Fixture } from "./support/database";
import { ingestLead } from "@/services/lead-intake";
import { getProductDashboard } from "@/services/product-read-models";
import { processFollowupCadence } from "@/services/followups";
import { persistRows } from "@/services/google-sheets-sync";
import { googleSheetMappingSchema } from "@/integrations/google-sheets";

const auth = vi.hoisted(() => ({ user: null as null | { id: string; tenantId: string; name: string; role: "owner" | "salesperson" | "agency" } }));
vi.mock("@/lib/auth", () => ({ readSession: async () => auth.user }));

import { POST as closeLead } from "@/app/api/leads/[id]/close/route";
import { POST as answerFollowup } from "@/app/api/followups/[id]/route";
import { POST as assignLead } from "@/app/api/leads/[id]/assign/route";

function atIst(daysAgo: number, hour: number, minute = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: "year" | "month" | "day") => Number(parts.find((part) => part.type === type)?.value);
  const day = new Date(Date.UTC(get("year"), get("month") - 1, get("day") - daysAgo));
  const ymd = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2,"0")}-${String(day.getUTCDate()).padStart(2,"0")}`;
  return new Date(`${ymd}T${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}:00+05:30`);
}

const localDate = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);

async function attempt(fixture: Fixture, leadId: string, when: Date, userId = fixture.salespersonA) {
  await sql`INSERT INTO app.attempts (tenant_id,lead_id,user_id,channel,initiated_at) VALUES (${fixture.tenantId},${leadId},${userId},'call',${when})`;
}

async function closeResponse(leadId: string, body: Record<string, unknown>) {
  return closeLead(new Request(`http://localhost/api/leads/${leadId}/close`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id: leadId }) });
}

describe("single close gate", () => {
  it.each([
    ["dead", "not_interested"],
    ["bad", "not_reachable"],
    ["bad", "spam"],
  ] as const)("enforces two attempts on two days for %s/%s", async (outcome, reason) => {
    const fixture = await createFixture();
    auth.user = sessionFor(fixture);
    const leadId = await insertLead(fixture, { assignedTo: fixture.salespersonA, receivedAt: atIst(2, 11) });

    await attempt(fixture, leadId, atIst(1, 11));
    let response = await closeResponse(leadId, { outcome, reason });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ allowed: false, attempts: 1, distinct_days: 1 });

    await attempt(fixture, leadId, atIst(1, 12));
    response = await closeResponse(leadId, { outcome, reason });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ allowed: false, attempts: 2, distinct_days: 1 });

    await attempt(fixture, leadId, atIst(0, 11));
    response = await closeResponse(leadId, { outcome, reason });
    expect(response.status).toBe(200);
  });

  it.each([
    ["dead", "bought_elsewhere", undefined],
    ["dead", "price_too_high", undefined],
    ["dead", "other", "Customer gave another reason."],
    ["bad", "wrong_number", undefined],
    ["bad", "fake_enquiry", undefined],
    ["won", undefined, undefined],
  ] as const)("does not gate %s/%s", async (outcome, reason, note) => {
    const fixture = await createFixture();
    auth.user = sessionFor(fixture);
    const leadId = await insertLead(fixture, {});
    const response = await closeResponse(leadId, { outcome, reason, note, orderValue: outcome === "won" ? 25000 : undefined });
    expect(response.status).toBe(200);
  });
});

describe("follow-up API", () => {
  it("requires a same-day tap for Yes and a ten-character note for either answer", async () => {
    const fixture = await createFixture();
    auth.user = sessionFor(fixture, fixture.salespersonA, "salesperson");
    const leadId = await insertLead(fixture, { stage: "contacted" });
    const followupId = randomUUID();
    await sql`INSERT INTO app.lead_followups (id,tenant_id,lead_id,assigned_to,day_number,due_date) VALUES (${followupId},${fixture.tenantId},${leadId},${fixture.salespersonA},1,${localDate(new Date())})`;
    const call = (answer: "yes" | "no", note: string) => answerFollowup(
      new Request(`http://localhost/api/followups/${followupId}`, { method: "POST", body: JSON.stringify({ answer, note }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: followupId }) },
    );

    expect((await call("yes", "A meaningful follow-up note")).status).toBe(422);
    await attempt(fixture, leadId, new Date());
    expect((await call("yes", "too short")).status).toBe(422);
    expect((await call("yes", "Customer answered the follow-up call.")).status).toBe(200);
  });
});

describe("store-hours first response", () => {
  it("stores ten minutes for a 21:30 lead first tapped at 10:40 next day", async () => {
    const fixture = await createFixture();
    const leadId = await insertLead(fixture, { receivedAt: atIst(1, 21, 30) });
    await attempt(fixture, leadId, atIst(0, 10, 40));
    const [lead] = await sql<{ first_response_minutes: number }[]>`SELECT first_response_minutes FROM app.leads WHERE tenant_id=${fixture.tenantId} AND id=${leadId}`;
    expect(lead.first_response_minutes).toBe(10);
  });
});

describe("round-robin assignment", () => {
  it("alternates active salespeople, skips disabled users, and falls back to owner", async () => {
    const fixture = await createFixture();
    const assignees: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const result = await sql.begin((transaction) => ingestLead(transaction, fixture.tenantId, {
        source: "csv_import", externalId: `round-robin-${index}-${fixture.tenantId}`, arrivedAt: new Date(),
        fullNameRaw: `Lead ${index}`, phoneRaw: `+9197000${String(index).padStart(5,"0")}`,
      }));
      const [lead] = await sql<{ assigned_to: string }[]>`SELECT assigned_to FROM app.leads WHERE tenant_id=${fixture.tenantId} AND id=${result.leadId}`;
      assignees.push(lead.assigned_to);
    }
    expect(new Set(assignees)).toEqual(new Set([fixture.salespersonA, fixture.salespersonB]));
    expect(assignees).toEqual([assignees[0], assignees[1], assignees[0], assignees[1]]);
    expect(assignees).not.toContain(fixture.disabledSalesperson);

    await sql`UPDATE app.users SET status='disabled' WHERE tenant_id=${fixture.tenantId} AND role='salesperson'`;
    const fallback = await sql.begin((transaction) => ingestLead(transaction, fixture.tenantId, {
      source: "csv_import", externalId: `owner-fallback-${fixture.tenantId}`, arrivedAt: new Date(), fullNameRaw: "Owner Lead", phoneRaw: "+919711111111",
    }));
    const [lead] = await sql<{ assigned_to: string }[]>`SELECT assigned_to FROM app.leads WHERE tenant_id=${fixture.tenantId} AND id=${fallback.leadId}`;
    expect(lead.assigned_to).toBe(fixture.ownerId);
  });
});

describe("repeat enquiries", () => {
  it("reactivates dormant, logs open repeats, and creates a new lead after closure", async () => {
    const fixture = await createFixture();
    const ingest = (externalId: string, phoneRaw: string) => sql.begin((transaction) => ingestLead(transaction, fixture.tenantId, {
      source: "csv_import", externalId, arrivedAt: new Date(), fullNameRaw: "Repeat Lead", phoneRaw,
    }));

    const open = await ingest(`open-1-${fixture.tenantId}`, "+919722222221");
    expect((await ingest(`open-2-${fixture.tenantId}`, "+919722222221"))).toMatchObject({ action: "repeat_open", leadId: open.leadId });
    const [openEvent] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM app.lead_events WHERE tenant_id=${fixture.tenantId} AND lead_id=${open.leadId} AND event_type='repeat_enquiry'`;
    expect(openEvent.count).toBe(1);

    const dormant = await ingest(`dormant-1-${fixture.tenantId}`, "+919722222222");
    await sql`UPDATE app.leads SET stage='dormant' WHERE tenant_id=${fixture.tenantId} AND id=${dormant.leadId}`;
    expect((await ingest(`dormant-2-${fixture.tenantId}`, "+919722222222"))).toMatchObject({ action: "reactivated", leadId: dormant.leadId });

    const closed = await ingest(`closed-1-${fixture.tenantId}`, "+919722222223");
    await sql`UPDATE app.leads SET stage='won',order_value=1000,conversation_state='closed',closed_at=clock_timestamp(),closed_by=${fixture.ownerId} WHERE tenant_id=${fixture.tenantId} AND id=${closed.leadId}`;
    const afterClose = await ingest(`closed-2-${fixture.tenantId}`, "+919722222223");
    expect(afterClose.action).toBe("inserted");
    expect(afterClose.leadId).not.toBe(closed.leadId);
  });
});

describe("Google Sheets cutoff", () => {
  it("skips historic rows and ingests a new row without starting an old timer", async () => {
    const fixture = await createFixture();
    const result = await persistRows({
      tenantId: fixture.tenantId,
      connection: {
        id: randomUUID(), spreadsheet_id: "sheet-smoke-test-id-123456789", sheet_name: "Leads", header_row: 1,
        mapping: {}, created_by: fixture.ownerId, import_after: atIst(1, 0), last_synced_row: 0, last_full_check_at: null,
      },
      mapping: googleSheetMappingSchema.parse({}),
      rows: [
        { rowNumber: 2, values: { external_id: `old-${fixture.tenantId}`, created_at: "01/01/2020 11:00", name: "Old Lead", phone: "+919733333331" } },
        { rowNumber: 3, values: { external_id: `new-${fixture.tenantId}`, created_at: localDate(new Date()).split("-").reverse().join("/") + " 11:00", name: "New Lead", phone: "+919733333332" } },
      ],
    });
    expect(result).toMatchObject({ rowsSeen: 2, inserted: 1, skipped: 1 });
    const leads = await sql<{ assigned_to: string }[]>`SELECT assigned_to FROM app.leads WHERE tenant_id=${fixture.tenantId}`;
    expect(leads).toHaveLength(1);
    expect([fixture.salespersonA, fixture.salespersonB]).toContain(leads[0].assigned_to);
  });
});

describe("four-day cadence", () => {
  it("continues past a missed day and moves the lead to dormant after day four", async () => {
    const fixture = await createFixture();
    const leadId = await insertLead(fixture, { receivedAt: atIst(6, 11) });
    await attempt(fixture, leadId, atIst(6, 11, 5));
    const [firstAttempt] = await sql<{ id: string }[]>`SELECT id FROM app.attempts WHERE tenant_id=${fixture.tenantId} AND lead_id=${leadId} ORDER BY initiated_at LIMIT 1`;
    const rows = await sql<{ id: string; day_number: number }[]>`SELECT id,day_number FROM app.lead_followups WHERE tenant_id=${fixture.tenantId} AND lead_id=${leadId} ORDER BY day_number`;
    expect(rows).toHaveLength(4);
    await sql`UPDATE app.lead_followups SET status='done',answer='yes',note='Reached the customer on day one.',attempt_id=${firstAttempt.id},answered_at=clock_timestamp(),answered_by=${fixture.salespersonA} WHERE id=${rows[0].id}`;
    await sql`UPDATE app.lead_followups SET status='done',answer='no',note='Customer did not answer on day two.',answered_at=clock_timestamp(),answered_by=${fixture.salespersonA} WHERE id=${rows[1].id}`;
    await sql`UPDATE app.lead_followups SET status='missed' WHERE id=${rows[2].id}`;
    const secondAttemptId = randomUUID();
    await sql`INSERT INTO app.attempts (id,tenant_id,lead_id,user_id,channel,initiated_at) VALUES (${secondAttemptId},${fixture.tenantId},${leadId},${fixture.salespersonA},'whatsapp',clock_timestamp())`;
    await sql`UPDATE app.lead_followups SET status='done',answer='yes',note='Reached the customer again on day four.',attempt_id=${secondAttemptId},answered_at=clock_timestamp(),answered_by=${fixture.salespersonA} WHERE id=${rows[3].id}`;
    await processFollowupCadence(fixture.tenantId);
    const [lead] = await sql<{ stage: string }[]>`SELECT stage::text FROM app.leads WHERE tenant_id=${fixture.tenantId} AND id=${leadId}`;
    const statuses = await sql<{ day_number: number; status: string }[]>`SELECT day_number,status::text FROM app.lead_followups WHERE tenant_id=${fixture.tenantId} AND lead_id=${leadId} ORDER BY day_number`;
    expect(lead.stage).toBe("dormant");
    expect(statuses).toEqual([{ day_number: 1, status: "done" }, { day_number: 2, status: "done" }, { day_number: 3, status: "missed" }, { day_number: 4, status: "done" }]);
  });
});

describe("concurrent cross-source dedupe", () => {
  it("keeps one lead when Sheet and webhook arrive together", async () => {
    const fixture = await createFixture();
    const shared = { externalId: `same-${fixture.tenantId}`, metaLeadId: `meta-${fixture.tenantId}`, arrivedAt: new Date(), fullNameRaw: "Concurrent Lead", phoneRaw: "+919744444444" };
    const [sheet, meta] = await Promise.all([
      sql.begin((transaction) => ingestLead(transaction, fixture.tenantId, { ...shared, source: "csv_import", externalId: `sheet-${shared.externalId}` })),
      sql.begin((transaction) => ingestLead(transaction, fixture.tenantId, { ...shared, source: "meta_lead_form", externalId: `meta-${shared.externalId}` })),
    ]);
    expect(new Set([sheet.leadId, meta.leadId]).size).toBe(1);
    const [count] = await sql<{ total: number }[]>`SELECT count(*)::int AS total FROM app.leads WHERE tenant_id=${fixture.tenantId} AND meta_lead_id=${shared.metaLeadId}`;
    expect(count.total).toBe(1);
  });
});

describe("closed follow-ups", () => {
  it("cancels pending rows on Won and excludes them from metrics", async () => {
    const fixture = await createFixture();
    auth.user = sessionFor(fixture);
    const leadId = await insertLead(fixture, { receivedAt: atIst(0, 11) });
    for (const day of [1, 2]) await sql`INSERT INTO app.lead_followups (tenant_id,lead_id,assigned_to,day_number,due_date) VALUES (${fixture.tenantId},${leadId},${fixture.salespersonA},${day},${localDate(new Date())})`;
    expect((await closeResponse(leadId, { outcome: "won", orderValue: 50000 })).status).toBe(200);
    const dashboard = await getProductDashboard(sessionFor(fixture), "today");
    const person = dashboard.people.find((row) => row.id === fixture.salespersonA);
    expect(person?.followupsDue).toBe(0);
    const [rows] = await sql<{ pending: number; cancelled: number }[]>`SELECT count(*) FILTER (WHERE status='pending')::int AS pending,count(*) FILTER (WHERE status='cancelled')::int AS cancelled FROM app.lead_followups WHERE tenant_id=${fixture.tenantId} AND lead_id=${leadId}`;
    expect(rows).toEqual({ pending: 0, cancelled: 2 });
  });
});

describe("follow-up attribution", () => {
  it("keeps A's missed work and attributes B's later completed work to B", async () => {
    const fixture = await createFixture();
    auth.user = sessionFor(fixture);
    const leadId = await insertLead(fixture, { assignedTo: fixture.salespersonA, receivedAt: atIst(2, 11) });
    await attempt(fixture, leadId, atIst(2, 11, 5));
    const rows = await sql<{ id: string; day_number: number }[]>`SELECT id,day_number FROM app.lead_followups WHERE tenant_id=${fixture.tenantId} AND lead_id=${leadId} ORDER BY day_number`;
    await sql`UPDATE app.lead_followups SET status='missed' WHERE tenant_id=${fixture.tenantId} AND id=${rows[0].id}`;

    const response = await assignLead(new Request(`http://localhost/api/leads/${leadId}/assign`, { method: "POST", body: JSON.stringify({ userId: fixture.salespersonB, reason: "Owner reassignment test" }), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id: leadId }) });
    expect(response.status).toBe(200);
    const pending = await sql<{ assigned_to: string; status: string }[]>`SELECT assigned_to,status::text FROM app.lead_followups WHERE tenant_id=${fixture.tenantId} AND lead_id=${leadId} ORDER BY day_number`;
    expect(pending[0]).toMatchObject({ assigned_to: fixture.salespersonA, status: "missed" });
    expect(pending.slice(1).every((row) => row.assigned_to === fixture.salespersonB)).toBe(true);

    const done = await answerFollowup(new Request(`http://localhost/api/followups/${rows[1].id}`, { method: "POST", body: JSON.stringify({ answer: "no", note: "No response on the second follow-up." }), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id: rows[1].id }) });
    expect(done.status).toBe(200);
    const counts = await sql<{ assigned_to: string; done: number; missed: number }[]>`
      SELECT assigned_to,count(*) FILTER (WHERE status='done')::int AS done,count(*) FILTER (WHERE status='missed')::int AS missed
      FROM app.lead_followups WHERE tenant_id=${fixture.tenantId} AND lead_id=${leadId} GROUP BY assigned_to ORDER BY assigned_to
    `;
    expect(counts.find((row) => row.assigned_to === fixture.salespersonA)).toMatchObject({ done: 0, missed: 1 });
    expect(counts.find((row) => row.assigned_to === fixture.salespersonB)).toMatchObject({ done: 1, missed: 0 });
  });
});

describe("dashboard metrics", () => {
  it("computes every salesperson metric for Today, 7 days and 30 days", async () => {
    const fixture = await createFixture();
    const add = async (who: string, days: number, stage: Parameters<typeof insertLead>[1]["stage"], first: number | null, reason?: string, source: "csv_import" | "meta_lead_form" = "csv_import") => {
      const receivedAt = atIst(days, 11);
      return insertLead(fixture, { assignedTo: who, receivedAt, stage, firstContactedAt: first == null ? null : new Date(receivedAt.getTime() + first * 60_000), firstResponseMinutes: first, closedAt: ["won","dead","bad"].includes(stage ?? "") ? atIst(days, 16) : null, outcomeReason: reason, updatedAt: atIst(days, 16), source });
    };
    const aLead = await add(fixture.salespersonA, 0, "contacted", 4, undefined, "meta_lead_form");
    await add(fixture.salespersonA, 0, "new", null);
    await add(fixture.salespersonA, 0, "won", 6);
    await add(fixture.salespersonA, 0, "dead", 10, "not_interested");
    await add(fixture.salespersonA, 0, "bad", null, "spam");
    await add(fixture.salespersonA, 0, "dormant", 2);
    await add(fixture.salespersonA, 3, "contacted", 20, undefined, "meta_lead_form");
    await add(fixture.salespersonA, 3, "dead", null, "price_too_high");
    await add(fixture.salespersonA, 3, "dormant", 5);
    await add(fixture.salespersonA, 10, "contacted", 5);
    await add(fixture.salespersonA, 10, "bad", 8, "fake_enquiry");
    await add(fixture.salespersonA, 10, "dormant", null);

    const bLead = await add(fixture.salespersonB, 0, "won", 2, undefined, "meta_lead_form");
    await add(fixture.salespersonB, 0, "bad", null, "wrong_number");
    await add(fixture.salespersonB, 3, "new", null);
    await add(fixture.salespersonB, 3, "dead", 7, "bought_elsewhere");
    await add(fixture.salespersonB, 10, "dormant", 4, undefined, "meta_lead_form");

    const addFollowup = (leadId: string, assignedTo: string, days: number, status: "pending" | "done" | "missed" | "cancelled") => sql`
      INSERT INTO app.lead_followups (tenant_id,lead_id,assigned_to,day_number,due_date,status,answer,note,answered_at,answered_by)
      VALUES (${fixture.tenantId},${leadId},${assignedTo},1,${localDate(atIst(days, 12))},${status},
        ${status === "done" ? "no" : null},${status === "done" ? "Dashboard test follow-up note" : null},${status === "done" ? atIst(days, 13) : null},${status === "done" ? assignedTo : null})
    `;
    await addFollowup(aLead, fixture.salespersonA, 0, "done");
    await addFollowup(aLead, fixture.salespersonA, 0, "missed");
    await addFollowup(aLead, fixture.salespersonA, 0, "cancelled");
    await addFollowup(aLead, fixture.salespersonA, 3, "done");
    await addFollowup(aLead, fixture.salespersonA, 3, "missed");
    await addFollowup(aLead, fixture.salespersonA, 10, "missed");
    await addFollowup(aLead, fixture.salespersonA, 10, "cancelled");
    await addFollowup(bLead, fixture.salespersonB, 0, "pending");
    await addFollowup(bLead, fixture.salespersonB, 3, "cancelled");
    await addFollowup(bLead, fixture.salespersonB, 3, "done");
    await addFollowup(bLead, fixture.salespersonB, 10, "missed");

    const user = sessionFor(fixture);
    const today = await getProductDashboard(user, "today");
    const seven = await getProductDashboard(user, "7");
    const thirty = await getProductDashboard(user, "30");
    const person = (data: Awaited<ReturnType<typeof getProductDashboard>>, id: string) => data.people.find((row) => row.id === id);

    expect(person(today, fixture.salespersonA)).toEqual({ id: fixture.salespersonA, name: "Asha", assigned: 6, avgResponseMinutes: 6, withinFivePercent: 50, untouched: 2, followupsDue: 2, followupsDone: 1, followupsMissed: 1, dormant: 1, won: 1, dead: 1, bad: 1, reasons: { not_interested: 1, spam: 1 } });
    expect(person(today, fixture.salespersonB)).toEqual({ id: fixture.salespersonB, name: "Bina", assigned: 2, avgResponseMinutes: 2, withinFivePercent: 100, untouched: 1, followupsDue: 1, followupsDone: 0, followupsMissed: 0, dormant: 0, won: 1, dead: 0, bad: 1, reasons: { wrong_number: 1 } });
    expect(today.sources).toEqual({ meta: 2, sheet: 6 });

    expect(person(seven, fixture.salespersonA)).toEqual({ id: fixture.salespersonA, name: "Asha", assigned: 9, avgResponseMinutes: 8, withinFivePercent: 50, untouched: 3, followupsDue: 4, followupsDone: 2, followupsMissed: 2, dormant: 2, won: 1, dead: 2, bad: 1, reasons: { not_interested: 1, price_too_high: 1, spam: 1 } });
    expect(person(seven, fixture.salespersonB)).toEqual({ id: fixture.salespersonB, name: "Bina", assigned: 4, avgResponseMinutes: 5, withinFivePercent: 50, untouched: 2, followupsDue: 2, followupsDone: 1, followupsMissed: 0, dormant: 0, won: 1, dead: 1, bad: 1, reasons: { bought_elsewhere: 1, wrong_number: 1 } });
    expect(seven.sources).toEqual({ meta: 3, sheet: 10 });

    expect(person(thirty, fixture.salespersonA)).toEqual({ id: fixture.salespersonA, name: "Asha", assigned: 12, avgResponseMinutes: 8, withinFivePercent: 50, untouched: 4, followupsDue: 5, followupsDone: 2, followupsMissed: 3, dormant: 3, won: 1, dead: 2, bad: 2, reasons: { fake_enquiry: 1, not_interested: 1, price_too_high: 1, spam: 1 } });
    expect(person(thirty, fixture.salespersonB)).toEqual({ id: fixture.salespersonB, name: "Bina", assigned: 5, avgResponseMinutes: 4, withinFivePercent: 67, untouched: 2, followupsDue: 3, followupsDone: 1, followupsMissed: 1, dormant: 1, won: 1, dead: 1, bad: 1, reasons: { bought_elsewhere: 1, wrong_number: 1 } });
    expect(thirty.sources).toEqual({ meta: 4, sheet: 13 });
  });
});
