import { ChevronRight, Clock3, IndianRupee, PhoneCall } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DesktopShell } from "@/components/desktop-shell";
import { readSession } from "@/lib/auth";
import { getDashboardData } from "@/services/read-models";

function duration(value: number | null) { return value == null ? "—" : `${Math.floor(value / 60)}m ${String(value % 60).padStart(2, "0")}s`; }
function timer(value: number) { const prefix = value < 0 ? "+" : ""; const absolute = Math.abs(value); return `${prefix}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`; }

export default async function Home() {
  const user = await readSession();
  if (!user) redirect("/login");
  if (user.role === "salesperson") redirect("/today");
  const data = await getDashboardData(user);
  const attention = data.waiting.filter((lead) => lead.state !== "calm");
  const today = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" }).format(new Date());
  return <DesktopShell active="/" title="Response desk" eyebrow={`${today} · Santacruz`}>
    <p className="page-intro owner-intro">A live view of every enquiry, response and outcome.</p>
    <section className="attention-banner" aria-label="Attention needed"><div><span className="attention-icon"><Clock3 size={17} /></span><p><strong>{attention.length} lead{attention.length === 1 ? "" : "s"} need attention</strong><small>{attention.filter((lead) => lead.state === "breach").length} have crossed the first-touch target.</small></p></div><Link href="/today">Open priority queue <ChevronRight size={16} /></Link></section>

    <section className="metric-strip metric-links" aria-label="Headline metrics">
      <Link href="/leads"><p>Leads received</p><div><strong>{data.leads}</strong></div><small>Visible in your workspace</small></Link>
      <Link href="/leads?view=attention"><p>Median first response</p><div><strong>{duration(data.medianSeconds)}</strong></div><small>Target is under 5 min</small></Link>
      <Link href="/leads?view=attention"><p>Touched within SLA</p><div><strong>{data.leads ? Math.round(data.withinSla / data.leads * 100) : 0}%</strong></div><small>{data.withinSla} of {data.leads} leads</small></Link>
      <Link href="/leads?view=contacted"><p>Connect rate</p><div><strong>{data.leads ? Math.round(data.connected / data.leads * 100) : 0}%</strong></div><small>{data.connected} people connected</small></Link>
      <Link href="/leads?view=visits"><p>Store visits</p><div><strong>{data.visitsBooked} <em>/ {data.visitsDone}</em></strong></div><small>Booked / completed</small></Link>
      <Link className="revenue" href="/reports"><p>Won and revenue</p><div><strong>{data.won}</strong><span><IndianRupee size={15} />{new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(data.revenue)}</span></div><small>From tracked leads</small></Link>
    </section>

    <section className="dashboard-grid">
      <article className="panel distribution-panel"><div className="panel-title"><div><h2>First response distribution</h2><p>{data.leads} visible leads</p></div><Link href="/reports">Reports <ChevronRight size={14} /></Link></div><div className="chart-wrap"><div className="chart-y"><span>40%</span><span>30%</span><span>20%</span><span>10%</span><span>0</span></div><div className="bars">{data.buckets.map((bucket) => <div className="bar-slot" key={bucket.label}><span>{bucket.value}%</span><div className="bar" style={{ height: `${bucket.value * 4.4}px`, background: bucket.color }} /><small>{bucket.label}</small></div>)}</div></div><div className="chart-insight"><Clock3 size={16} /><span><strong>{data.leads ? Math.round((data.leads - data.withinSla) / data.leads * 100) : 0}%</strong> of visible leads missed or have not yet met the five-minute target.</span></div></article>
      <article className="panel live-board"><div className="panel-title"><div><h2>Waiting for first touch</h2><p>Worst first</p></div><span className="urgent-count">{data.waiting.length} live</span></div><div className="live-list">{data.waiting.map((lead) => <Link className={`live-row ${lead.state}`} href={`/leads/${lead.id}`} key={lead.id}><span className="state-bar" /><span className="lead-copy"><strong>{lead.name}</strong><small>{lead.city} · {lead.owner}</small></span><time>{timer(lead.timer)}</time><span className="round-icon"><PhoneCall size={16} /></span></Link>)}</div><Link className="panel-link" href="/leads?view=attention">See all waiting leads <ChevronRight size={15} /></Link></article>
    </section>

    <section className="panel team-panel"><div className="panel-title"><div><h2>By salesperson</h2><p>Actions and outcomes shown side by side</p></div><Link href="/reports">Open report</Link></div><div className="table-scroll"><table><thead><tr><th>Salesperson</th><th>Leads</th><th>Median response</th><th>Attempts / lead</th><th>Connect rate</th><th>Visits</th><th>Won</th><th>SLA breaches</th></tr></thead><tbody>{data.people.map((person) => <tr key={person.name}><td><span className="person-dot">{person.name[0]}</span><strong>{person.name}</strong></td><td>{person.leads}</td><td className={person.breaches > 10 ? "danger-text" : ""}>{duration(person.medianSeconds)}</td><td>{person.attempts}</td><td>{person.connect}%</td><td>{person.visits}</td><td className="gold-text">{person.won}</td><td><span className={person.breaches > 10 ? "breach-pill" : "quiet-pill"}>{person.breaches}</span></td></tr>)}</tbody></table></div></section>
  </DesktopShell>;
}
