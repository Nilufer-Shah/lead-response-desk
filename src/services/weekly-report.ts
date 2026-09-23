import { spawn } from "node:child_process";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { withTenant } from "@/db";
import { env } from "@/lib/env";

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
const formatDuration = (seconds: number | null) => seconds == null ? "No response" : seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

function runChromium(htmlPath: string, pdfPath: string) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(env().CHROMIUM_PATH, ["--headless", "--no-sandbox", "--disable-gpu", `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`], { stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    child.stderr.on("data", (chunk) => { error += String(chunk); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`Chromium exited with ${code}: ${error.slice(-1000)}`)));
  });
}

export async function generateWeeklyPdf(tenantId: string, periodStart: string, periodEnd: string, commentary?: string) {
  const data = await withTenant({ tenantId, userRole: "system" }, async (transaction) => {
    const [tenant] = await transaction<{ client_name: string; accent_color: string }[]>`SELECT client_name, accent_color FROM app.tenants WHERE tenant_id = ${tenantId}`;
    const [summary] = await transaction<{ leads: number; touched: number; median_seconds: number | null; attempts: number; connected: number; visits: number; won: number; revenue: string }[]>`
      SELECT
        count(*)::integer AS leads,
        count(*) FILTER (WHERE first_touch_at IS NOT NULL AND first_touch_at <= sla_due_at)::integer AS touched,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_touch_at - received_at)) FILTER (WHERE first_touch_at IS NOT NULL)::integer AS median_seconds,
        (SELECT count(*)::integer FROM app.attempts a WHERE a.tenant_id = ${tenantId} AND (a.initiated_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${periodStart}::date AND ${periodEnd}::date) AS attempts,
        (SELECT count(DISTINCT ae.attempt_id)::integer FROM app.attempt_events ae JOIN app.attempts a ON a.tenant_id = ae.tenant_id AND a.id = ae.attempt_id WHERE ae.tenant_id = ${tenantId} AND (ae.occurred_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${periodStart}::date AND ${periodEnd}::date AND ae.event_type = 'disposition_logged' AND ae.payload ->> 'disposition' IN ('connected','interested','visit_booked')) AS connected,
        (SELECT count(*)::integer FROM app.lead_events e WHERE e.tenant_id = ${tenantId} AND (e.occurred_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${periodStart}::date AND ${periodEnd}::date AND e.event_type = 'visit_done') AS visits,
        count(*) FILTER (WHERE stage = 'won')::integer AS won,
        COALESCE(sum(order_value) FILTER (WHERE stage = 'won'), 0)::text AS revenue
      FROM app.leads WHERE tenant_id = ${tenantId} AND (received_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${periodStart}::date AND ${periodEnd}::date
    `;
    const people = await transaction<{ name: string; leads: number; median_seconds: number | null; attempts: number; breaches: number; won: number }[]>`
      SELECT u.display_name AS name, count(l.id)::integer AS leads,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM l.first_touch_at - l.received_at)) FILTER (WHERE l.first_touch_at IS NOT NULL)::integer AS median_seconds,
        COALESCE(sum(l.attempt_count), 0)::integer AS attempts, count(l.id) FILTER (WHERE l.sla_breached)::integer AS breaches,
        count(l.id) FILTER (WHERE l.stage = 'won')::integer AS won
      FROM app.users u LEFT JOIN app.leads l ON l.tenant_id = u.tenant_id AND l.assigned_to = u.id AND (l.received_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${periodStart}::date AND ${periodEnd}::date
      WHERE u.tenant_id = ${tenantId} AND u.role = 'salesperson' GROUP BY u.id, u.display_name ORDER BY u.display_name
    `;
    const slowest = await transaction<{ full_name: string | null; city: string | null; received_at: Date; first_touch_at: Date | null; seconds: number | null }[]>`
      SELECT full_name, city, received_at, first_touch_at, extract(epoch FROM COALESCE(first_touch_at, clock_timestamp()) - received_at)::integer AS seconds
      FROM app.leads WHERE tenant_id = ${tenantId} AND (received_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${periodStart}::date AND ${periodEnd}::date ORDER BY seconds DESC LIMIT 5
    `;
    const [quality] = await transaction<{ flagged: number; gate_failures: number }[]>`
      SELECT count(*) FILTER (WHERE quality_flag <> 'unrated')::integer AS flagged,
        count(*) FILTER (WHERE quality_flag <> 'unrated' AND attempt_count < 3)::integer AS gate_failures
      FROM app.leads WHERE tenant_id = ${tenantId} AND (received_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${periodStart}::date AND ${periodEnd}::date
    `;
    const [version] = await transaction<{ next: number }[]>`SELECT COALESCE(max(version), 0)::integer + 1 AS next FROM app.reports WHERE tenant_id = ${tenantId} AND kind = 'weekly' AND period_start = ${periodStart}::date`;
    const [report] = await transaction<{ id: string }[]>`
      INSERT INTO app.reports (tenant_id, kind, period_start, period_end, version, status, commentary)
      VALUES (${tenantId}, 'weekly', ${periodStart}::date, ${periodEnd}::date, ${version.next}, 'rendering', ${commentary ?? null}) RETURNING id
    `;
    return { tenant, summary, people, slowest, quality, report };
  });
  const directory = resolve(env().REPORTS_DIR, tenantId);
  await mkdir(directory, { recursive: true });
  const htmlPath = resolve(directory, `${data.report.id}.html`);
  const pdfPath = resolve(directory, `${data.report.id}.pdf`);
  const percentage = data.summary.leads ? Math.round(data.summary.touched / data.summary.leads * 100) : 0;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font-family:Inter,Arial,sans-serif;color:#0E1726;margin:0;font-size:11px}header{display:flex;justify-content:space-between;border-bottom:3px solid ${escapeHtml(data.tenant.accent_color)};padding-bottom:9px}h1{font-size:21px;margin:0}h2{font-size:12px;margin:13px 0 6px}.period{color:#64708a}.metrics{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin:12px 0}.metric{border:1px solid #d8dce5;padding:8px}.metric strong{display:block;font-size:17px}.metric span{color:#64708a}.columns{display:grid;grid-template-columns:1.2fr .8fr;gap:12px}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #e4e6ec;padding:5px 3px}th{color:#64708a}.bar{height:12px;background:#eceef4;margin:4px 0}.bar i{display:block;height:100%;background:${escapeHtml(data.tenant.accent_color)}}.comment{border-left:3px solid ${escapeHtml(data.tenant.accent_color)};padding:7px 9px;background:#f5f3f8}.empty{padding:18px;border:1px solid #d8dce5;color:#64708a}footer{position:fixed;bottom:0;left:0;right:0;text-align:right;font-size:8px;color:#7b8498}</style></head><body><header><div><h1>${escapeHtml(data.tenant.client_name)} weekly lead report</h1><div class="period">${escapeHtml(periodStart)} to ${escapeHtml(periodEnd)}</div></div><strong>Lead response</strong></header>${data.summary.leads === 0 ? '<div class="empty">No leads were received in this period.</div>' : `<div class="metrics"><div class="metric"><strong>${data.summary.leads}</strong><span>Leads</span></div><div class="metric"><strong>${formatDuration(data.summary.median_seconds)}</strong><span>Median response</span></div><div class="metric"><strong>${percentage}%</strong><span>Within SLA</span></div><div class="metric"><strong>${data.summary.attempts}</strong><span>Attempts</span></div><div class="metric"><strong>${data.summary.connected}</strong><span>Connected</span></div><div class="metric"><strong>Rs ${escapeHtml(data.summary.revenue)}</strong><span>${data.summary.won} won</span></div></div><div class="bar"><i style="width:${percentage}%"></i></div><div class="columns"><section><h2>By salesperson</h2><table><thead><tr><th>Name</th><th>Leads</th><th>Median</th><th>Attempts</th><th>Breaches</th><th>Won</th></tr></thead><tbody>${data.people.map((person) => `<tr><td>${escapeHtml(person.name)}</td><td>${person.leads}</td><td>${formatDuration(person.median_seconds)}</td><td>${person.attempts}</td><td>${person.breaches}</td><td>${person.won}</td></tr>`).join("")}</tbody></table><h2>Slowest five leads</h2><table><tbody>${data.slowest.map((lead) => `<tr><td>${escapeHtml(lead.full_name || "Unnamed lead")}</td><td>${escapeHtml(lead.city)}</td><td>${formatDuration(lead.seconds)}</td></tr>`).join("")}</tbody></table></section><section><h2>Lead quality review</h2><div class="metric"><strong>${data.quality.flagged}</strong><span>Flagged leads</span></div><div class="metric"><strong>${data.quality.gate_failures}</strong><span>Need evidence review</span></div><h2>Commentary</h2><div class="comment">${escapeHtml(commentary || "Response speed and follow-up depth are shown together. Review slow leads and evidence gaps with the team.")}</div></section></div>`}<footer>Generated by Lead Response Desk</footer></body></html>`;
  await writeFile(htmlPath, html, "utf8");
  try {
    await runChromium(htmlPath, pdfPath);
    await withTenant({ tenantId, userRole: "system" }, async (transaction) => {
      await transaction`UPDATE app.reports SET status = 'generated', storage_path = ${pdfPath}, generated_at = clock_timestamp() WHERE tenant_id = ${tenantId} AND id = ${data.report.id}`;
      const [owner] = await transaction<{ id: string }[]>`SELECT id FROM app.users WHERE tenant_id = ${tenantId} AND role = 'owner' AND status = 'active' ORDER BY created_at LIMIT 1`;
      if (owner) await transaction`
        INSERT INTO app.notifications (tenant_id, recipient_user_id, channel, template, deduplication_key, payload)
        VALUES (${tenantId}, ${owner.id}, 'whatsapp', 'weekly_report', ${`weekly-report:${data.report.id}`}, ${JSON.stringify({ reportId: data.report.id, periodStart, periodEnd, summary: data.summary })}::jsonb)
        ON CONFLICT (tenant_id, deduplication_key) DO NOTHING
      `;
    });
  } catch (error) {
    await withTenant({ tenantId, userRole: "system" }, (transaction) => transaction`UPDATE app.reports SET status = 'failed' WHERE tenant_id = ${tenantId} AND id = ${data.report.id}`);
    throw error;
  } finally { await unlink(htmlPath).catch(() => undefined); }
  return { reportId: data.report.id, pdfPath };
}
