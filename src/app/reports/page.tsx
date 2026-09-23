import { CalendarDays, CheckCircle2, Clock3, FileText, MessageCircle, PhoneCall, Store } from "lucide-react";
import { DesktopShell } from "@/components/desktop-shell";
import { SendTestDigestButton } from "@/components/send-test-digest-button";
import { readSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getDailyMetricHistory, getDashboardData, getReportHistory } from "@/services/read-models";

function duration(value: number | null) { return value == null ? "—" : `${Math.floor(value / 60)}m ${String(value % 60).padStart(2, "0")}s`; }

export default async function ReportsPage() {
  const user = await readSession();
  if (!user) redirect("/login");
  const data = await getDashboardData(user);
  if (user.role === "salesperson") return <DesktopShell active="/reports" title="My results" eyebrow={`${user.name} · Current visible period`}>
    <section className="staff-results-hero"><div><small>Response score</small><strong>{data.leads ? Math.round(data.withinSla / data.leads * 100) : 0}</strong><span>Percentage touched within target</span></div><p>Your score uses server-recorded attempts and response times. Timely follow-ups protect both the customer experience and the evidence trail.</p></section>
    <div className="summary-cards staff-result-cards"><article><PhoneCall /><div><strong>{data.people[0]?.attempts ?? 0}</strong><small>Attempts per lead</small></div></article><article><Clock3 /><div><strong>{duration(data.medianSeconds)}</strong><small>Median first response</small></div></article><article><Store /><div><strong>{data.visitsBooked}</strong><small>Visits booked</small></div></article></div>
    <section className="panel personal-scorecard"><div className="panel-title"><div><h2>Current activity</h2><p>Only server-recorded actions are counted</p></div></div><div className="scorecard-rows"><span><strong>{data.leads}</strong> leads assigned <CheckCircle2 /></span><span><strong>{data.withinSla}</strong> touched within five minutes <CheckCircle2 /></span><span><strong>{data.connected}</strong> conversations connected <CheckCircle2 /></span><span><strong>{data.won}</strong> sales won · ₹{new Intl.NumberFormat("en-IN").format(data.revenue)} <CheckCircle2 /></span></div></section>
  </DesktopShell>;

  const [history, daily] = await Promise.all([getReportHistory(user), getDailyMetricHistory(user)]);
  return <DesktopShell active="/reports" title="Reports" eyebrow="Owner updates that arrive automatically">
    <div className="report-grid"><section className="panel report-card"><div className="report-icon"><MessageCircle /></div><small>Daily · 9:15 PM IST</small><h2>Owner WhatsApp digest</h2><pre>{`Roopkala, current view\n\nNew leads                 ${data.leads}\nTouched in 5 min          ${data.withinSla}  (${data.leads ? Math.round(data.withinSla / data.leads * 100) : 0}%)\nStill untouched           ${data.leads - data.connected}\nMedian first response     ${duration(data.medianSeconds)}\nConnected                 ${data.connected}\nStore visits booked       ${data.visitsBooked}\nWon                       ${data.won}  ₹${new Intl.NumberFormat("en-IN").format(data.revenue)}`}</pre><SendTestDigestButton /></section>
      <section className="panel report-card"><div className="report-icon"><FileText /></div><small>Weekly · Monday 10:00 AM IST</small><h2>One-page owner report</h2><p>Headline numbers, response distribution, salesperson results, slow leads and the quality-review summary.</p><a href="/reports/weekly"><FileText size={17} />Open print-ready report</a><div className="next-report"><CalendarDays /><span>Next report<strong>Monday, 10:00 AM</strong></span></div></section></div>
    <section className="panel report-history"><div className="panel-title"><div><h2>Daily history</h2><p>Past days come from immutable 11:55 PM snapshots; today remains live</p></div></div><div className="table-scroll"><table><thead><tr><th>Date</th><th>Leads</th><th>Within SLA</th><th>Median response</th><th>Connected</th><th>Visits</th><th>Won</th><th>Revenue</th></tr></thead><tbody>{daily.length ? daily.map((day) => <tr key={day.date}><td>{day.date}</td><td>{day.leads}</td><td>{day.withinSla}</td><td>{duration(day.medianSeconds)}</td><td>{day.connected}</td><td>{day.visits}</td><td>{day.won}</td><td>₹{new Intl.NumberFormat("en-IN").format(day.revenue)}</td></tr>) : <tr><td colSpan={8}>The first snapshot will appear at 11:55 PM IST.</td></tr>}</tbody></table></div></section>
    <section className="panel report-history"><div className="panel-title"><div><h2>Report history</h2><p>Every generated version remains available</p></div></div><table><thead><tr><th>Period</th><th>Type</th><th>Version</th><th>Status</th><th>Generated</th></tr></thead><tbody>{history.map((report) => <tr key={report.id}><td>{report.period}</td><td>{report.kind}</td><td>v{report.version}</td><td><span className="healthy-tag">{report.status}</span></td><td>{report.generated}</td></tr>)}</tbody></table></section>
  </DesktopShell>;
}
