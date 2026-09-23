"use client";

import { useState } from "react";
import { ChevronRight, Filter, MapPin, MessageCircle, PhoneCall, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import type { LeadCard } from "@/domain/read-models";

const views = [
  { id: "all", label: "All", matches: () => true },
  { id: "attention", label: "Needs attention", matches: (lead: LeadCard) => lead.state === "breach" || lead.state === "warn" },
  { id: "new", label: "New", matches: (lead: LeadCard) => lead.stage === "New" },
  { id: "contacted", label: "Contacted", matches: (lead: LeadCard) => lead.stage === "Contacted" },
  { id: "visits", label: "Visits", matches: (lead: LeadCard) => lead.stage === "Visit booked" },
];

export function LeadInbox({ user, initialLeads, initialView = "all" }: { user: SessionUser; initialLeads: LeadCard[]; initialView?: string }) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState(views.some((item) => item.id === initialView) ? initialView : "all");
  const selected = views.find((item) => item.id === view) ?? views[0];
  const normalized = query.trim().toLowerCase();
  const leads = initialLeads.filter((lead) => {
    const searchable = `${lead.name} ${lead.phone} ${lead.city} ${lead.campaign}`.toLowerCase();
    return selected.matches(lead) && (!normalized || searchable.includes(normalized));
  });

  return <div className="lead-inbox">
    <div className="inbox-context"><div><strong>{user.role === "salesperson" ? "My assigned leads" : "All store leads"}</strong><span>{leads.length} shown · Tap any lead to open the response flow</span></div><span><SlidersHorizontal size={15} />{user.role === "salesperson" ? "Salesperson workspace" : "Management workspace"}</span></div>
    <div className="toolbar lead-toolbar"><label><Search size={17} /><input aria-label="Search leads" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, phone, city or campaign" /></label><button type="button" onClick={() => setView("attention")}><Filter size={16} />Urgent</button>{user.role !== "salesperson" && <Link href="/admin#imports">Import leads</Link>}</div>
    <div className="filter-tabs" role="tablist" aria-label="Lead filters">{views.map((item) => <button className={view === item.id ? "active" : ""} onClick={() => setView(item.id)} role="tab" aria-selected={view === item.id} key={item.id}>{item.label}</button>)}</div>

    {leads.length === 0 ? <section className="empty-state"><Search /><h2>No matching leads</h2><p>Try another search or clear the active filter.</p><button onClick={() => { setQuery(""); setView("all"); }}>Show all leads</button></section> : <>
      <section className="mobile-inbox-list" aria-label="Lead list">{leads.map((lead) => <article className={`inbox-lead-card ${lead.state}`} key={lead.id}>
        <Link className="inbox-lead-main" href={`/leads/${lead.id}`}><span className="lead-avatar">{lead.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span className="inbox-lead-copy"><strong>{lead.name}</strong><small><MapPin size={12} />{lead.city} · {lead.campaign}</small><em>{lead.stage} · {lead.followup}</em></span><span className="inbox-timer">{lead.state === "breach" ? "Overdue" : lead.state === "warn" ? "Due now" : "On track"}<ChevronRight size={17} /></span></Link>
        <div className="inbox-quick-actions"><a href={`tel:${lead.phone.replace(/\s/g, "")}`}><PhoneCall size={16} />Call</a><a href={`https://wa.me/${lead.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer"><MessageCircle size={16} />WhatsApp</a></div>
      </article>)}</section>

      <section className="panel data-panel desktop-inbox-table"><div className="table-scroll"><table><thead><tr><th>Lead</th><th>Status</th><th>Owner</th><th>Campaign</th><th>First response</th><th>Attempts</th><th>Next action</th><th /></tr></thead><tbody>{leads.map((lead) => <tr key={lead.id}><td><Link className="lead-table-name" href={`/leads/${lead.id}`}><strong>{lead.name}</strong><small>{lead.city} · {lead.phone}</small></Link></td><td><span className={`stage-tag ${lead.stage.toLowerCase().replaceAll(" ", "-")}`}>{lead.stage}</span></td><td>{lead.owner}</td><td>{lead.campaign}</td><td className={lead.state === "breach" ? "danger-text" : ""}>{lead.firstResponseSeconds == null ? "Untouched" : `${Math.floor(lead.firstResponseSeconds / 60)}m ${lead.firstResponseSeconds % 60}s`}</td><td>{lead.attempts}</td><td>{lead.followup}</td><td><Link className="row-open" href={`/leads/${lead.id}`} aria-label={`Open ${lead.name}`}><ChevronRight size={17} /></Link></td></tr>)}</tbody></table></div></section>
    </>}
  </div>;
}
