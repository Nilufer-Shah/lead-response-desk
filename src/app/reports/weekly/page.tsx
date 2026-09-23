import { redirect } from "next/navigation";
import { PrintReportButton } from "@/components/print-report-button";
import { readSession } from "@/lib/auth";
import { getDashboardData, getQualityCases } from "@/services/read-models";

function duration(value: number | null) { return value == null ? "—" : `${Math.floor(value / 60)}m ${String(value % 60).padStart(2, "0")}s`; }

export default async function WeeklyReportPage() {
  const user = await readSession();
  if (!user) redirect("/login");
  if (user.role === "salesperson") redirect("/reports");
  const [data, quality] = await Promise.all([getDashboardData(user), getQualityCases(user)]);
  const end = new Date(); const start = new Date(end.getTime() - 6 * 86_400_000);
  const period = `${new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(start)}–${new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(end)}`;
  return <main className="weekly-report"><header><div><small>Roopkala Lead Desk</small><h1>Weekly lead response</h1><p>{period}</p></div><PrintReportButton /></header><section className="report-metrics"><div><small>Leads</small><strong>{data.leads}</strong></div><div><small>Median response</small><strong>{duration(data.medianSeconds)}</strong></div><div><small>Within 5 min</small><strong>{data.leads ? Math.round(data.withinSla / data.leads * 100) : 0}%</strong></div><div><small>Connected</small><strong>{data.leads ? Math.round(data.connected / data.leads * 100) : 0}%</strong></div><div><small>Visits</small><strong>{data.visitsBooked} / {data.visitsDone}</strong></div><div><small>Won</small><strong>{data.won} · ₹{new Intl.NumberFormat("en-IN").format(data.revenue)}</strong></div></section>
    <section className="print-columns"><div><h2>First response distribution</h2><div className="print-bars">{data.buckets.map((bucket) => <div key={bucket.label}><small>{bucket.label}</small><span><i style={{ width: `${Math.min(100, bucket.value * 2)}%` }} /></span><strong>{bucket.value}%</strong></div>)}</div></div><div><h2>Plain-English commentary</h2><p className="commentary-box">{data.leads - data.withinSla} visible leads missed or have not yet met the five-minute first-touch target. {data.connected} conversations connected and {data.visitsBooked} reached a visit stage.</p><h2>Quality review</h2><p>{quality.length} leads are flagged. {quality.filter((item) => item.status === "Gate failed" || item.status === "Returned").length} claims still need evidence.</p></div></section>
    <section><h2>By salesperson</h2><table><thead><tr><th>Salesperson</th><th>Leads</th><th>Median response</th><th>Attempts / lead</th><th>Connect</th><th>Visits</th><th>Won</th></tr></thead><tbody>{data.people.map((person) => <tr key={person.name}><td>{person.name}</td><td>{person.leads}</td><td>{duration(person.medianSeconds)}</td><td>{person.attempts}</td><td>{person.connect}%</td><td>{person.visits}</td><td>{person.won}</td></tr>)}</tbody></table></section>
    <section><h2>Slowest current leads</h2><ol className="slowest-list">{data.waiting.sort((a, b) => a.timer - b.timer).slice(0, 5).map((lead) => <li key={lead.id}>{lead.name} · {lead.city} · {lead.timer < 0 ? `${Math.ceil(Math.abs(lead.timer) / 60)} minutes overdue` : `${Math.ceil(lead.timer / 60)} minutes remaining`}</li>)}</ol></section><footer>Generated from immutable Lead Response Desk activity records</footer>
  </main>;
}
