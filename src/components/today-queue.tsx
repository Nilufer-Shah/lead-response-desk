"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { CalendarClock, CheckCircle2, ChevronRight, Clock3, LogOut, PhoneCall, Target, UsersRound } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import type { LeadCard } from "@/domain/read-models";
import { flushOfflineQueue, queueOfflineMutation } from "@/lib/offline-queue";
import { MobileBottomNav } from "@/components/app-navigation";

function formatTimer(seconds: number) {
  const prefix = seconds < 0 ? "+" : "";
  const absolute = Math.abs(seconds);
  return `${prefix}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

export function TodayQueue({ user, initialLeads }: { user: SessionUser; initialLeads: LeadCard[] }) {
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [leads, setLeads] = useState(initialLeads);
  const isStaff = user.role === "salesperson";
  const roleLabel = isStaff ? "Salesperson" : user.role === "admin" ? "Administrator" : user.role === "owner" ? "Owner" : "Management";
  const assigned = leads;
  const urgent = assigned.filter((lead) => lead.state === "breach" || lead.state === "warn");
  const due = assigned.filter((lead) => lead.stage !== "New").slice(0, 3);
  const todayLabel = useMemo(() => new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(new Date()), []);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    const online = () => void flushOfflineQueue();
    window.addEventListener("online", online);
    return () => { clearInterval(timer); window.removeEventListener("online", online); };
  }, []);

  async function logCall(leadId: string, phone: string) {
    const body = { leadId, channel: "call" };
    try {
      const response = await fetch("/api/attempts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error();
    } catch { await queueOfflineMutation("/api/attempts", body); }
    const lead = assigned.find((item) => item.id === leadId);
    setLeads((current) => current.map((item) => item.id === leadId ? { ...item, attempts: (lead?.attempts ?? 0) + 1 } : item));
    setNotice("Call started. Log the outcome when you return.");
    window.setTimeout(() => { window.location.href = `tel:${phone.replace(/\s/g, "")}`; }, 180);
  }

  const first = urgent[0] ?? assigned[0];
  return <div className="phone-app staff-workspace">
    <header className="staff-appbar"><Link href={isStaff ? "/today" : "/"}><span className="mobile-logo-crop"><Image src="/roopkala-logo.webp" alt="" width={609} height={336} unoptimized /></span><span><strong>Roopkala Lead Desk</strong><small>{user.name} · {roleLabel}</small></span></Link><form action="/api/auth/logout" method="post"><button aria-label="Switch account"><LogOut size={18} /></button></form></header>
    <header className="mobile-head"><div><p>{todayLabel}</p><h1>{isStaff ? "My day" : "Priority queue"}</h1><span className="workspace-subtitle"><UsersRound size={14} />{assigned.length} {isStaff ? "assigned" : "open"} leads</span></div><div className="target-chip"><Target size={16} /><span>4 / 8</span><small>visits</small></div></header>
    <section className="queue-progress"><span><strong>{urgent.length}</strong> need a response</span><span><strong>{due.length}</strong> follow-ups due</span><span><strong>1</strong> visit today</span></section>

    <section className="mobile-section"><div className="section-row"><h2>Needs you now</h2><span className="urgent-count">{urgent.length} leads</span></div>
      <div className="mobile-lead-list">{urgent.map((lead) => { const time = lead.timer - tick; const state = time < 0 ? "breach" : time < 120 ? "warn" : "calm"; return <Link href={`/leads/${lead.id}`} className={`mobile-lead ${state}`} key={lead.id}><span className="mobile-state-bar" /><span className="mobile-lead-copy"><strong>{lead.name}</strong><small>{lead.city} · {lead.campaign}</small><em>{lead.attempts ? `${lead.attempts} attempt${lead.attempts === 1 ? "" : "s"}` : "No attempt yet"}</em></span><time>{formatTimer(time)}</time><ChevronRight size={18} /></Link>; })}</div>
    </section>

    <section className="mobile-section"><div className="section-row"><h2>Due today</h2><Link href="/leads?view=contacted">See all</Link></div>{due.map((lead) => <Link href={`/leads/${lead.id}`} className="due-row" key={lead.id}><CalendarClock size={18} /><span><strong>{lead.name}</strong><small>{lead.followup}</small></span><ChevronRight size={17} /></Link>)}</section>
    <section className="mobile-section"><div className="section-row"><h2>Waiting on lead</h2><span>1</span></div><div className="quiet-empty"><Clock3 size={18} /><span>Anjali D. · WhatsApp delivered</span><small>3d</small></div></section>
    {notice && <div className="saved-toast queue-toast"><CheckCircle2 size={17} />{notice}</div>}
    {first && <div className="call-next"><button onClick={() => void logCall(first.id, first.phone)}><PhoneCall size={21} />Call next <span>{first.name}</span></button></div>}
    <MobileBottomNav active="/today" user={user} />
  </div>;
}
