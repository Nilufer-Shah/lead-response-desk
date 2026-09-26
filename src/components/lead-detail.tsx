"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronRight, MessageCircle, NotebookPen, PhoneCall, RefreshCw, RotateCcw, UserRoundCog, X } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import type { LeadDetailData } from "@/services/product-read-models";
import { MobileBottomNav } from "@/components/app-navigation";

const deadReasons = ["not_interested", "bought_elsewhere", "price_too_high", "other"];
const badReasons = ["spam", "wrong_number", "not_reachable", "fake_enquiry"];

function recordAttempt(leadId: string, channel: "call" | "whatsapp") {
  const body = JSON.stringify({ leadId, channel });
  if (navigator.sendBeacon) navigator.sendBeacon("/api/attempts", new Blob([body], { type: "application/json" }));
  else void fetch("/api/attempts", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true });
}

function words(value: string) { return value.replaceAll("_", " "); }

export function LeadDetail({ data, user }: { data: LeadDetailData; user: SessionUser }) {
  const [sheet, setSheet] = useState<"note" | "followup" | "outcome" | "assign" | "repeat" | null>(null);
  const [followupId, setFollowupId] = useState("");
  const [outcome, setOutcome] = useState<"won" | "dead" | "bad">("won");
  const [reason, setReason] = useState("");
  const [gate, setGate] = useState<{ allowed: boolean; attempts: number; distinct_days: number; required_attempts: number; required_days: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const closed = ["won", "dead", "bad"].includes(data.lead.stage);
  const readOnly = user.role === "agency";

  useEffect(() => {
    if (sheet !== "outcome") return;
    const query = new URLSearchParams({ outcome }); if (reason) query.set("reason", reason);
    void fetch(`/api/leads/${data.lead.id}/close?${query}`, { cache: "no-store" }).then(async (response) => response.ok && setGate(await response.json()));
  }, [data.lead.id, outcome, reason, sheet]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setFormError(null);
    setSaving(true);
    const values = new FormData(event.currentTarget);
    let endpoint = `/api/leads/${data.lead.id}/notes`;
    let body: Record<string, unknown> = { body: values.get("note") };
    if (sheet === "followup") { endpoint = `/api/followups/${followupId}`; body = { answer: values.get("answer"), note: values.get("note") }; }
    if (sheet === "outcome") { endpoint = `/api/leads/${data.lead.id}/close`; body = { outcome, reason: reason || undefined, note: values.get("note") || undefined, orderValue: Number(values.get("orderValue")) || undefined }; }
    if (sheet === "assign") { endpoint = `/api/leads/${data.lead.id}/assign`; body = { userId: values.get("userId"), reason: values.get("reason") }; }
    if (sheet === "repeat") { endpoint = `/api/leads/${data.lead.id}/repeat`; body = {}; }
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string; leadId?: string };
      if (!response.ok) return setFormError(result.error ?? "Could not save this change");
      if (sheet === "repeat" && result.leadId) { window.location.assign(`/leads/${result.leadId}`); return; }
      setSheet(null); setMessage("Saved. Refreshing the lead…"); window.setTimeout(() => window.location.reload(), 450);
    } catch {
      setFormError("The change could not be saved. Check the connection and try again.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  function openSheet(next: "note" | "followup" | "outcome" | "assign" | "repeat") {
    setFormError(null);
    setSheet(next);
  }

  const phone = data.lead.phone.replace(/\D/g, "");
  return <div className="lead-detail-page product-lead-detail">
    <header className="lead-detail-head"><Link href={user.role === "salesperson" ? "/today" : "/leads"} aria-label="Back"><ArrowLeft /></Link><div><p>{data.lead.owner} · {words(data.lead.source)}</p><h1>{data.lead.name}</h1></div><span className={`stage-tag ${data.lead.stage}`}>{words(data.lead.stage)}</span></header>
    <section className="lead-facts"><div><small>Phone</small><a href={`tel:${data.lead.phone}`}>{data.lead.phone}</a></div><div><small>Location</small><strong>{data.lead.city}</strong></div><div><small>Campaign</small><strong>{data.lead.campaign}</strong></div><div><small>First response</small><strong>{data.lead.firstResponseMinutes == null ? "Untouched" : `${data.lead.firstResponseMinutes} min`}</strong></div></section>

    {!readOnly && !closed && <section className="primary-contact-bar"><a href={`tel:${data.lead.phone}`} onClick={() => recordAttempt(data.lead.id, "call")}><PhoneCall />Call</a><a href={`https://wa.me/${phone}`} target="_blank" rel="noreferrer" onClick={() => recordAttempt(data.lead.id, "whatsapp")}><MessageCircle />WhatsApp</a><button onClick={() => openSheet("note")}><NotebookPen />Note</button></section>}

    <section className="followup-card"><header><div><h2>Four-day follow-up</h2><p>Every Yes needs a Call or WhatsApp attempt today.</p></div><span>{data.followups.filter((item) => item.status === "done").length}/{data.followups.length}</span></header>{data.followups.length ? data.followups.map((item) => <div className={`followup-line ${item.status}`} key={item.id}><span>Day {item.dayNumber}</span><small>{item.dueDate}</small><strong>{item.status}{item.answer ? ` · ${item.answer}` : ""}</strong>{!readOnly && !closed && ["pending", "missed"].includes(item.status) ? <button onClick={() => { setFollowupId(item.id); openSheet("followup"); }}>Complete <ChevronRight size={15} /></button> : <em>{item.note ?? "—"}</em>}</div>) : <p className="queue-empty">Follow-ups begin after the first Call or WhatsApp tap.</p>}</section>

    {!readOnly && <section className="lead-management">{closed ? <button onClick={() => openSheet("repeat")}><RotateCcw />Create new enquiry</button> : <button onClick={() => openSheet("outcome")}><Check />Record outcome</button>}{user.role === "owner" && !closed && <button onClick={() => openSheet("assign")}><UserRoundCog />Reassign</button>}<button onClick={() => window.location.reload()}><RefreshCw />Refresh</button></section>}

    <section className="timeline"><div className="timeline-title"><h2>Complete timeline</h2><span>{data.lead.attempts} attempts</span></div>{data.timeline.map((event) => <div className={`timeline-event ${event.tone}`} key={event.id}><span /><time>{event.at}</time><div><strong>{event.title}</strong><small>{event.detail}</small></div></div>)}</section>

    {message && <button className="saved-toast" onClick={() => setMessage(null)}><Check size={16} />{message}</button>}
    {sheet && <div className="sheet-backdrop" onClick={() => !saving && setSheet(null)}><form className="action-sheet" onSubmit={submit} onClick={(event) => event.stopPropagation()}><header><div><small>{data.lead.name}</small><h2>{sheet === "note" ? "Add note" : sheet === "followup" ? "Complete follow-up" : sheet === "assign" ? "Reassign lead" : sheet === "repeat" ? "Create a new enquiry" : "Record final outcome"}</h2></div><button type="button" disabled={saving} aria-label="Close" onClick={() => setSheet(null)}><X /></button></header>
      {sheet === "note" && <label>Note<textarea name="note" required placeholder="What happened and what should happen next?" /></label>}
      {sheet === "followup" && <><p className="action-sheet-help">For “Yes”, first tap Call or WhatsApp on this lead today so the contact is recorded.</p><label>Did you speak with the lead?<select name="answer" required defaultValue=""><option value="" disabled>Select</option><option value="yes">Yes</option><option value="no">No</option></select></label><label>Note (minimum 10 characters)<textarea name="note" minLength={10} required /></label></>}
      {sheet === "assign" && <><label>Assign to<select name="userId" required defaultValue=""><option value="" disabled>Select</option>{data.assignees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Reason<textarea name="reason" minLength={5} required /></label></>}
      {sheet === "repeat" && <p className="repeat-enquiry-note">This keeps the previous outcome unchanged and opens a fresh lead for the customer’s new interest. The new response timer starts now.</p>}
      {sheet === "outcome" && <><div className="outcome-tabs">{(["won", "dead", "bad"] as const).map((item) => <button type="button" className={outcome === item ? "active" : ""} onClick={() => { setOutcome(item); setReason(""); }} key={item}>{item}</button>)}</div>{outcome !== "won" && <label>Reason<select value={reason} onChange={(event) => setReason(event.target.value)} required><option value="" disabled>Select</option>{(outcome === "dead" ? deadReasons : badReasons).map((item) => <option key={item} value={item}>{words(item)}</option>)}</select></label>}{outcome === "won" && <label>Order value<input name="orderValue" type="number" min="1" required /></label>}{outcome === "dead" && reason === "other" && <label>Note<textarea name="note" required /></label>}{gate && <div className={gate.allowed ? "gate-ready gate-status" : "gate-failed gate-status"}>{gate.required_attempts > 0 ? `${gate.attempts} of ${gate.required_attempts} attempts, ${gate.distinct_days} of ${gate.required_days} days${gate.allowed ? " · ready" : ""}` : "No additional evidence gate for this outcome"}</div>}</>}
      {formError && <p className="action-sheet-error" role="alert">{formError}</p>}
      <button className="primary-form-button" disabled={saving}>{saving ? "Saving…" : sheet === "repeat" ? "Create new enquiry" : "Save"}</button>
    </form></div>}
    <MobileBottomNav active="/leads" user={user} />
  </div>;
}
