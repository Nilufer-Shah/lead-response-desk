"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BellRing, Check, ChevronRight, Clock3, MessageCircle, NotebookPen, PhoneCall, RefreshCw, Volume2 } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import type { QueueLead, TodayQueueData } from "@/services/product-read-models";
import { MobileBottomNav } from "@/components/app-navigation";

function timer(minutes: number) {
  if (minutes < 5) return `${Math.max(0, 5 - minutes)}m left`;
  const overdue = minutes - 5;
  if (overdue < 60) return `+${overdue}m overdue`;
  const hours = Math.floor(overdue / 60);
  const remainder = overdue % 60;
  return `+${hours}h${remainder ? ` ${remainder}m` : ""} overdue`;
}

function recordAttempt(leadId: string, channel: "call" | "whatsapp") {
  const body = JSON.stringify({ leadId, channel });
  if (navigator.sendBeacon) navigator.sendBeacon("/api/attempts", new Blob([body], { type: "application/json" }));
  else void fetch("/api/attempts", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true });
}

function ContactActions({ lead }: { lead: QueueLead }) {
  const number = lead.phone.replace(/\D/g, "");
  return <div className="queue-contact-actions">
    <a href={`tel:${lead.phone.replace(/\s/g, "")}`} onClick={() => recordAttempt(lead.id, "call")}><PhoneCall size={17} />Call</a>
    <a href={`https://wa.me/${number}`} target="_blank" rel="noreferrer" onClick={() => recordAttempt(lead.id, "whatsapp")}><MessageCircle size={17} />WhatsApp</a>
  </div>;
}

function LeadRow({ lead, type, onFollowup, onNote }: { lead: QueueLead; type: "new" | "due" | "missed"; onFollowup: (lead: QueueLead) => void; onNote: (lead: QueueLead) => void }) {
  return <article className={`queue-lead-row ${type}`}>
    <Link href={`/leads/${lead.id}`} className="queue-lead-copy">
      <span><strong>{lead.name}</strong><em>{type === "new" ? timer(lead.elapsedBusinessMinutes) : `Day ${lead.followupDay} follow-up`}</em></span>
      <small>{lead.city} · {lead.campaign} · {lead.owner}</small>
      <small>{lead.ad}</small>
    </Link>
    <ContactActions lead={lead} />
    <div className="queue-row-buttons">
      {lead.followupId && <button onClick={() => onFollowup(lead)}><Check size={15} />Log follow-up</button>}
      <button onClick={() => onNote(lead)}><NotebookPen size={15} />Quick note</button>
      <Link href={`/leads/${lead.id}`} aria-label={`Open ${lead.name}`}><ChevronRight size={18} /></Link>
    </div>
  </article>;
}

export function TodayQueue({ user, initialData }: { user: SessionUser; initialData: TodayQueueData }) {
  const [data, setData] = useState(initialData);
  const [busy, setBusy] = useState(false);
  const [alerts, setAlerts] = useState(false);
  const [dialog, setDialog] = useState<{ kind: "note" | "followup"; lead: QueueLead } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const previousNew = useRef(initialData.newLeads.length);
  const submitting = useRef(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/today", { cache: "no-store" });
      if (!response.ok) throw new Error("Refresh failed");
      const next = await response.json() as TodayQueueData;
      if (alerts && next.newLeads.length > previousNew.current) {
        const context = new AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain();
        oscillator.connect(gain); gain.connect(context.destination); oscillator.frequency.value = 720; gain.gain.value = .08;
        oscillator.start(); oscillator.stop(context.currentTime + .2);
      }
      previousNew.current = next.newLeads.length;
      setData(next);
      setRefreshError(null);
    } catch {
      setRefreshError("Could not refresh. Showing the last available queue.");
    } finally { setBusy(false); }
  }, [alerts]);

  useEffect(() => {
    setAlerts(localStorage.getItem("lead-desk-alerts") === "on");
    const id = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  function enableAlerts() { localStorage.setItem("lead-desk-alerts", "on"); setAlerts(true); setMessage("Sound alerts enabled on this device"); }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!dialog) return;
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setFormError(null);
    const values = new FormData(event.currentTarget);
    const endpoint = dialog.kind === "note" ? `/api/leads/${dialog.lead.id}/notes` : `/api/followups/${dialog.lead.followupId}`;
    const body = dialog.kind === "note" ? { body: String(values.get("note") ?? "") } : { answer: values.get("answer"), note: values.get("note") };
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string };
      if (!response.ok) return setFormError(result.error ?? "Could not save");
      setDialog(null); setMessage(dialog.kind === "note" ? "Note saved" : "Follow-up completed"); await refresh();
    } catch {
      setFormError("Could not save. Check the connection and try again.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  const total = data.newLeads.length + data.dueFollowups.length + data.missedFollowups.length;
  return <div className="phone-app today-product">
    <header className="mobile-head"><div className="today-heading"><Link className="today-back" href="/" aria-label="Back to dashboard"><ArrowLeft size={20} /></Link><div><p>{user.name} · Sales desk</p><h1>Today</h1></div></div><button className="refresh-button" onClick={() => void refresh()} aria-label="Refresh"><RefreshCw size={19} className={busy ? "spinning" : ""} /></button></header>
    {refreshError && <p className="refresh-error" role="status">{refreshError}</p>}
    {!alerts && <button className="alert-permission" onClick={enableAlerts}><Volume2 size={19} /><span><strong>Turn on lead alerts</strong><small>Hear a sound when a new lead arrives</small></span></button>}
    <section className="today-summary"><span><BellRing size={16} />{total} actions</span><span><Clock3 size={16} />Store {data.storeOpen ? "open" : "closed"}</span><small>Refreshes every 30 seconds</small></section>

    <section className="queue-section"><header><div><h2>New leads</h2><p>Oldest first · five business-minute target</p></div><b>{data.newLeads.length}</b></header>
      {data.newLeads.length ? data.newLeads.map((lead) => <LeadRow key={lead.id} lead={lead} type="new" onFollowup={(item) => { setFormError(null); setDialog({ kind: "followup", lead: item }); }} onNote={(item) => { setFormError(null); setDialog({ kind: "note", lead: item }); }} />) : <p className="queue-empty">No untouched leads. You are caught up.</p>}
    </section>
    <section className="queue-section"><header><div><h2>Due today</h2><p>Complete after the conversation</p></div><b>{data.dueFollowups.length}</b></header>
      {data.dueFollowups.length ? data.dueFollowups.map((lead) => <LeadRow key={lead.followupId} lead={lead} type="due" onFollowup={(item) => { setFormError(null); setDialog({ kind: "followup", lead: item }); }} onNote={(item) => { setFormError(null); setDialog({ kind: "note", lead: item }); }} />) : <p className="queue-empty">No follow-ups due today.</p>}
    </section>
    <section id="missed-followups" className="queue-section missed"><header><div><h2>Missed follow-ups · all dates</h2><p>Unresolved after a previous store close</p></div><b>{data.missedFollowups.length}</b></header>
      {data.missedFollowups.length ? data.missedFollowups.map((lead) => <LeadRow key={lead.followupId} lead={lead} type="missed" onFollowup={(item) => { setFormError(null); setDialog({ kind: "followup", lead: item }); }} onNote={(item) => { setFormError(null); setDialog({ kind: "note", lead: item }); }} />) : <p className="queue-empty">No missed follow-ups.</p>}
    </section>
    {message && <button className="saved-toast" onClick={() => setMessage(null)}><Check size={16} />{message}</button>}
    {dialog && <div className="sheet-backdrop" onClick={() => !saving && setDialog(null)}><form className="action-sheet queue-sheet" onSubmit={submit} onClick={(event) => event.stopPropagation()}><header><div><small>{dialog.lead.name}</small><h2>{dialog.kind === "note" ? "Add a quick note" : `Day ${dialog.lead.followupDay} follow-up`}</h2></div></header>{dialog.kind === "followup" && <label>Did you speak with the lead?<select name="answer" required defaultValue=""><option value="" disabled>Select</option><option value="yes">Yes</option><option value="no">No</option></select></label>}<label>Note<textarea name="note" minLength={dialog.kind === "followup" ? 10 : 1} required placeholder="What happened and what comes next?" /></label>{formError && <p className="action-sheet-error" role="alert">{formError}</p>}<button className="primary-form-button" disabled={saving}>{saving ? "Saving…" : "Save"}</button></form></div>}
    <MobileBottomNav active="/today" user={user} />
  </div>;
}
