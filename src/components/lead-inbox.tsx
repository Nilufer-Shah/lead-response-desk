"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, MapPin, Search } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import type { LeadListItem } from "@/services/product-read-models";

const stages = ["all", "new", "contacted", "follow_up", "dormant", "won", "dead", "bad"];
const label = (value: string) => value.replaceAll("_", " ");

export function LeadInbox({ user, initialLeads, initialView = "all" }: { user: SessionUser; initialLeads: LeadListItem[]; initialView?: string }) {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState(stages.includes(initialView) ? initialView : "all");
  const leads = useMemo(() => initialLeads.filter((lead) => (stage === "all" || lead.stage === stage) && `${lead.name} ${lead.phone} ${lead.city} ${lead.campaign} ${lead.owner}`.toLowerCase().includes(query.toLowerCase().trim())), [initialLeads, query, stage]);
  return <div className="lead-inbox">
    <div className="inbox-context"><div><strong>{user.role === "salesperson" ? "My assigned leads" : "Lead register"}</strong><span>{leads.length} visible · Every row opens the working lead record</span></div></div>
    <div className="toolbar lead-toolbar"><label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, phone, city, campaign or owner" /></label>{user.role === "owner" && <Link href="/admin#imports">Import leads</Link>}</div>
    <div className="filter-tabs">{stages.map((item) => <button className={stage === item ? "active" : ""} onClick={() => setStage(item)} key={item}>{label(item)}</button>)}</div>
    {leads.length === 0 ? <section className="empty-state"><Search /><h2>No matching leads</h2><p>Try a different search or stage.</p></section> : <>
      <section className="mobile-inbox-list">{leads.map((lead) => <Link className="inbox-lead-card inbox-lead-main" href={`/leads/${lead.id}`} key={lead.id}><span className="lead-avatar">{lead.name.slice(0, 2).toUpperCase()}</span><span className="inbox-lead-copy"><strong>{lead.name}</strong><small><MapPin size={12} />{lead.city} · {lead.campaign}</small><em>{label(lead.stage)} · {lead.attempts} attempt{lead.attempts === 1 ? "" : "s"}</em></span><ChevronRight /></Link>)}</section>
      <section className="panel data-panel desktop-inbox-table"><div className="table-scroll"><table><thead><tr><th>Lead</th><th>Stage</th><th>Owner</th><th>Campaign</th><th>First response</th><th>Attempts</th><th>Outcome</th><th /></tr></thead><tbody>{leads.map((lead) => <tr key={lead.id}><td><Link className="lead-table-name" href={`/leads/${lead.id}`}><strong>{lead.name}</strong><small>{lead.city} · {lead.phone}</small></Link></td><td><span className={`stage-tag ${lead.stage}`}>{label(lead.stage)}</span></td><td>{lead.owner}</td><td>{lead.campaign}</td><td>{lead.firstResponseMinutes == null ? "Untouched" : `${lead.firstResponseMinutes} min`}</td><td>{lead.attempts}</td><td>{lead.outcomeReason ? label(lead.outcomeReason) : "—"}</td><td><Link className="row-open" href={`/leads/${lead.id}`}><ChevronRight /></Link></td></tr>)}</tbody></table></div></section>
    </>}
  </div>;
}
