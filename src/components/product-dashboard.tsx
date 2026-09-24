"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Clock3, RefreshCw, UserRoundX } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import type { DashboardData, DashboardPeriod } from "@/services/product-read-models";

const duration = (value: number | null) => value == null ? "—" : `${value} min`;

export function ProductDashboard({ user, initialData }: { user: SessionUser; initialData: DashboardData }) {
  const [period, setPeriod] = useState<DashboardPeriod>(initialData.period);
  const [data, setData] = useState(initialData);
  const [busy, setBusy] = useState(false);
  async function load(next = period) { setBusy(true); try { const response = await fetch(`/api/dashboard?period=${next}`, { cache: "no-store" }); if (response.ok) setData(await response.json()); } finally { setBusy(false); } }
  useEffect(() => { const id = window.setInterval(() => void load(), 30_000); return () => window.clearInterval(id); });
  function choose(next: DashboardPeriod) { setPeriod(next); void load(next); }
  const totals = data.totals;
  const periodLabel = period === "today" ? "Today" : `${period} days`;
  return <div className="product-dashboard">
    <div className="dashboard-controls"><div>{(["today", "7", "30"] as DashboardPeriod[]).map((item) => <button className={period === item ? "active" : ""} onClick={() => choose(item)} key={item}>{item === "today" ? "Today" : `${item} days`}</button>)}</div><button onClick={() => void load()}><RefreshCw className={busy ? "spinning" : ""} size={16} />Refresh</button></div>
    <section className="live-strip"><Link href="/leads?view=new"><UserRoundX /><span><small>Waiting right now (all dates)</small><strong>{data.live.untouched}</strong></span></Link><Link href="/leads?view=new"><Clock3 /><span><small>Oldest waiting</small><strong>{duration(data.live.oldestMinutes)}</strong><em>{data.live.oldestAssignee ?? "Nobody waiting"}</em></span></Link><Link href="/today"><AlertTriangle /><span><small>Missed follow-ups today</small><strong>{data.live.missedToday}</strong></span></Link></section>
    <p className="live-strip-caption">Live, regardless of date filter.</p>
    <section className="metric-strip product-metrics"><article><p>New leads ({periodLabel})</p><strong>{totals.assigned}</strong></article><article><p>Average response</p><strong>{duration(totals.avgResponseMinutes)}</strong></article><article><p>Within five minutes</p><strong>{totals.withinFivePercent}%</strong></article><article><p>Follow-ups done</p><strong>{totals.followupsDone}/{totals.followupsDue}</strong></article><article><p>Dormant</p><strong>{totals.dormant}</strong></article><article><p>Won</p><strong>{totals.won}</strong></article></section>
    <section className="panel team-panel"><div className="panel-title"><div><h2>{user.role === "salesperson" ? "My performance" : "By salesperson"}</h2><p>Response, follow-up and final outcomes</p></div>{user.role === "agency" && <span className="role-badge">Read only</span>}</div><div className="table-scroll"><table><thead><tr><th>Salesperson</th><th>Assigned</th><th>Avg response</th><th>≤5 min</th><th>Untouched</th><th>Follow-ups</th><th>Missed</th><th>Dormant</th><th>Won</th><th>Dead</th><th>Bad</th></tr></thead><tbody>{data.people.map((person) => <tr key={person.id}><td><strong>{person.name}</strong></td><td>{person.assigned}</td><td>{duration(person.avgResponseMinutes)}</td><td>{person.withinFivePercent}%</td><td>{person.untouched}</td><td>{person.followupsDone}/{person.followupsDue}</td><td>{person.followupsMissed}</td><td>{person.dormant}</td><td>{person.won}</td><td>{person.dead}</td><td>{person.bad}</td></tr>)}</tbody></table></div></section>
    <section className="dashboard-split"><article className="panel reason-panel"><div className="panel-title"><div><h2>Dead and bad reasons</h2><p>Team totals for this period</p></div></div>{Object.keys(totals.reasons).length ? Object.entries(totals.reasons).sort((a,b) => b[1]-a[1]).map(([reason,count]) => <div className="reason-row" key={reason}><span>{reason.replaceAll("_", " ")}</span><strong>{count}</strong></div>) : <p className="queue-empty">No closed reasons in this period.</p>}</article><article className="panel source-panel"><div className="panel-title"><div><h2>Lead source</h2><p>Imported versus direct Meta intake</p></div></div><div><span><strong>{data.sources.sheet}</strong>Google Sheet / CSV</span><span><strong>{data.sources.meta}</strong>Meta Lead Ads</span></div></article></section>
  </div>;
}
