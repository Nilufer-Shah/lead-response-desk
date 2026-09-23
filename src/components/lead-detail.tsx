"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, CalendarPlus, Check, ChevronDown, CircleX, ImageOff, MapPin, MessageCircle, NotebookPen, PhoneCall, X } from "lucide-react";
import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import type { LeadCard, TimelineItem } from "@/domain/read-models";
import { queueOfflineMutation } from "@/lib/offline-queue";
import { MobileBottomNav } from "@/components/app-navigation";

const dispositions = ["Connected", "No answer", "Busy", "Switched off", "Invalid number", "Call back later", "Interested", "Visit booked"];
const stages = ["New", "Contacted", "Qualified", "Visit booked", "Visited"];
const closeReasons = ["bought", "bought_elsewhere", "price_too_high", "out_of_area", "just_browsing", "unreachable", "wrong_number", "invalid_number", "duplicate", "spam", "no_response"];
const qualityFlags = ["", "good", "invalid_number", "wrong_person", "out_of_area", "budget_mismatch", "competitor", "spam", "duplicate"];
const nowLabel = () => new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date());

export function LeadDetail({ lead, user, initialTimeline, assignees }: { lead: LeadCard; user: SessionUser; initialTimeline: TimelineItem[]; assignees: Array<{ id: string; name: string }> }) {
  const [sheet, setSheet] = useState<"disposition" | "note" | "visit" | "stage" | "close" | "assign" | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [activeAttemptId, setActiveAttemptId] = useState<string | null>(null);
  const [stage, setStage] = useState(lead.stage);
  const [attempts, setAttempts] = useState(lead.attempts);
  const [owner, setOwner] = useState(lead.owner);
  const baseTimeline = useMemo(() => initialTimeline, [initialTimeline]);
  const [timeline, setTimeline] = useState<TimelineItem[]>(baseTimeline);

  function flash(message: string) { setSaved(message); setSheet(null); window.setTimeout(() => setSaved(null), 3000); }
  function warn(message: string) { setSaved(message); window.setTimeout(() => setSaved(null), 5000); }
  function addTimeline(event: TimelineItem) {
    const nextTimeline = [event, ...timeline];
    setTimeline(nextTimeline);
  }

  async function createAttempt(channel: "call" | "whatsapp") {
    const body = { leadId: lead.id, channel };
    try {
      const response = await fetch("/api/attempts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error();
      const attempt = await response.json() as { id: string };
      setActiveAttemptId(attempt.id);
      return attempt.id;
    } catch {
      await queueOfflineMutation("/api/attempts", body);
      return null;
    }
  }

  async function beginCall() {
    await createAttempt("call");
    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);
    setSheet("disposition");
    window.setTimeout(() => { window.location.href = `tel:${lead.phone.replace(/\s/g, "")}`; }, 160);
  }

  async function beginWhatsApp() {
    const target = window.open("about:blank", "_blank");
    const id = await createAttempt("whatsapp");
    if (id) await fetch(`/api/attempts/${id}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventType: "whatsapp_queued", payload: { origin: "lead_detail" } }) });
    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);
    addTimeline({ at: nowLabel(), title: "WhatsApp opened", detail: "First response message prepared", tone: "calm" });
    const message = encodeURIComponent(`Hi ${lead.name.split(" ")[0]}, this is ${user.name} from Roopkala. Thank you for your enquiry. How can I help you today?`);
    const url = `https://wa.me/${lead.phone.replace(/\D/g, "")}?text=${message}`;
    if (target) target.location.href = url;
    else window.location.href = url;
    flash("WhatsApp attempt recorded");
  }

  async function saveDisposition(disposition: string) {
    if (activeAttemptId) await fetch(`/api/attempts/${activeAttemptId}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventType: "disposition_logged", payload: { disposition: disposition.toLowerCase().replaceAll(" ", "_") } }) });
    const connected = ["Connected", "Interested", "Visit booked"].includes(disposition);
    const nextStage = connected && stage === "New" ? "Contacted" : stage;
    if (nextStage !== stage) {
      await fetch(`/api/leads/${lead.id}/stage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage: "contacted" }) });
      setStage(nextStage);
    }
    addTimeline({ at: nowLabel(), title: `Call: ${disposition}`, detail: connected ? "Conversation recorded and lead moved forward" : "Attempt recorded; follow-up remains due", tone: connected ? "calm" : "neutral" });
    flash(`Outcome saved: ${disposition}`);
  }

  async function saveNote(body: string) {
    const payload = { body };
    try { const response = await fetch(`/api/leads/${lead.id}/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); if (!response.ok) throw new Error(); }
    catch { await queueOfflineMutation(`/api/leads/${lead.id}/notes`, payload); }
    addTimeline({ at: nowLabel(), title: "Note added", detail: body, tone: "neutral" });
    flash("Note added to the timeline");
  }

  async function saveVisit(form: HTMLFormElement) {
    const data = new FormData(form);
    const visitAt = new Date(`${data.get("date")}T${data.get("time")}:00`).toISOString();
    const response = await fetch(`/api/leads/${lead.id}/stage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage: "visit_booked", visitAt }) });
    if (!response.ok) return flash("Visit could not be saved");
    setStage("Visit booked");
    addTimeline({ at: nowLabel(), title: "Store visit booked", detail: new Date(visitAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }), tone: "calm" });
    flash("Visit booked and added to the lead");
  }

  async function changeStage(next: string) {
    const payload: Record<string, unknown> = { stage: next.toLowerCase().replaceAll(" ", "_") };
    if (next === "Qualified") payload.requirementNote = "Qualified after confirming occasion, budget and visit preference.";
    const response = await fetch(`/api/leads/${lead.id}/stage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (!response.ok) { const data = await response.json(); return flash(data.error ?? "Stage could not be updated"); }
    setStage(next);
    addTimeline({ at: nowLabel(), title: `Moved to ${next}`, detail: `Updated by ${user.name}`, tone: next === "Won" ? "calm" : "neutral" });
    flash(`Lead moved to ${next}`);
  }

  async function closeLead(form: HTMLFormElement) {
    const data = new FormData(form);
    const closeReason = String(data.get("closeReason") ?? "");
    const qualityFlag = String(data.get("qualityFlag") ?? "");
    const orderValue = Number(data.get("orderValue") || 0) || undefined;
    const linkedLeadId = String(data.get("linkedLeadId") ?? "") || undefined;
    const response = await fetch(`/api/leads/${lead.id}/close`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ closeReason: closeReason || undefined, qualityFlag: qualityFlag || undefined, note: String(data.get("note") ?? ""), orderValue, linkedLeadId }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) return warn(result.error ?? "The lead cannot be closed yet");
    const nextStage = closeReason === "bought" ? "Won" : "Lost";
    setStage(nextStage);
    addTimeline({ at: nowLabel(), title: `Lead closed · ${closeReason.replaceAll("_", " ") || qualityFlag.replaceAll("_", " ")}`, detail: `Closed by ${user.name}`, tone: closeReason === "bought" ? "calm" : "neutral" });
    flash(`Lead marked ${nextStage}`);
  }

  async function assignLead(form: HTMLFormElement) {
    const data = new FormData(form); const userId = String(data.get("userId") ?? "");
    const response = await fetch(`/api/leads/${lead.id}/assign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId, reason: String(data.get("reason") ?? "") }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) return warn(result.error ?? "Lead could not be reassigned");
    const name = assignees.find((item) => item.id === userId)?.name ?? "New owner";
    setOwner(name); addTimeline({ at: nowLabel(), title: `Assigned to ${name}`, detail: `Reassigned by ${user.name}`, tone: "neutral" }); flash(`Assigned to ${name}`);
  }

  const backHref = user.role === "salesperson" ? "/today" : "/leads";
  const progressStages = stage === "Won" || stage === "Lost" ? [...stages, stage] : stages;
  return <div className="lead-detail-page functional-lead-detail">
    <header className="lead-detail-head"><Link href={backHref} aria-label="Back"><ArrowLeft /></Link><div><p>{user.name} · {user.role === "salesperson" ? "Salesperson" : "Management"}</p><h1>{lead.name}</h1></div><span className={`detail-sla ${lead.state}`}>{lead.state === "breach" ? "+23:14" : lead.state === "warn" ? "01:06" : "On track"}</span></header>
    <button className="stage-progress" onClick={() => setSheet("stage")} disabled={stage === "Won" || stage === "Lost"}><span><small>Current stage</small><strong>{stage}</strong></span><span>{progressStages.map((item) => <i className={progressStages.indexOf(item) <= progressStages.indexOf(stage) ? "done" : ""} key={item} />)}</span><ChevronDown size={18} /></button>
    <section className="identity-card"><div><a className="phone-link" href={`tel:${lead.phone.replace(/\s/g, "")}`}>{lead.phone}</a><span><MapPin size={14} />{lead.city}</span></div><span className="international-chip">{lead.isInternational ? "International · 24 hr SLA" : `${owner} · Santacruz`}</span>{(["manager", "owner", "admin"] as string[]).includes(user.role) && <button className="reassign-link" onClick={() => setSheet("assign")}>Reassign</button>}</section>
    <section className="creative-card"><div className="creative-placeholder"><ImageOff size={22} /><small>Creative preview pending source connection</small></div><div><small>Enquired from</small><h2>{lead.ad}</h2><p>{lead.campaign}</p></div></section>
    {lead.customFields && Object.keys(lead.customFields).filter((key) => !key.startsWith("_")).length > 0 && <section className="form-answers"><h2>What they asked for</h2><dl>{Object.entries(lead.customFields).filter(([key]) => !key.startsWith("_")).slice(0, 6).map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{String(value)}</dd></div>)}</dl></section>}
    <section className="timeline"><div className="timeline-title"><h2>Activity</h2><span>{attempts} attempt{attempts === 1 ? "" : "s"}</span></div>{timeline.map((event, index) => <div className={`timeline-event ${event.tone} ${event.corrected ? "corrected" : ""}`} key={event.id ?? `${event.at}-${event.title}-${index}`}><span /><time>{event.at}</time><div><strong>{event.title}{event.corrected ? " · corrected" : ""}</strong><small>{event.detail}</small>{event.clientAt && <small>{event.clientAt}</small>}</div></div>)}</section>
    <div className="lead-actions"><button onClick={() => void beginCall()}><PhoneCall />Call</button><button onClick={() => void beginWhatsApp()}><MessageCircle />WhatsApp</button><button onClick={() => setSheet("note")}><NotebookPen />Note</button><button onClick={() => setSheet("visit")}><CalendarPlus />Book visit</button><button onClick={() => setSheet("close")}><CircleX />Close</button></div>
    {saved && <div className="saved-toast"><Check size={17} />{saved}</div>}
    {sheet && <div className="sheet-backdrop" onClick={() => setSheet(null)}><section className="action-sheet" onClick={(event) => event.stopPropagation()}><header><div><small>{lead.name}</small><h2>{sheet === "disposition" ? "What happened on the call?" : sheet === "note" ? "Add a note" : sheet === "visit" ? "Book a store visit" : sheet === "close" ? "Close or flag this lead" : sheet === "assign" ? "Assign this lead" : "Update lead stage"}</h2></div><button onClick={() => setSheet(null)} aria-label="Close"><X /></button></header>
      {sheet === "disposition" && <div className="disposition-grid">{dispositions.map((item) => <button key={item} onClick={() => void saveDisposition(item)}>{item}</button>)}</div>}
      {sheet === "note" && <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void saveNote(String(data.get("body") ?? "")); }}><textarea name="body" minLength={1} required placeholder="What did the lead say? What should happen next?" /><button className="primary-form-button">Save note</button></form>}
      {sheet === "visit" && <form onSubmit={(event) => { event.preventDefault(); void saveVisit(event.currentTarget); }}><label>Date<input name="date" type="date" required /></label><label>Time<input name="time" type="time" required /></label><button className="primary-form-button">Book visit</button></form>}
      {sheet === "stage" && <div className="stage-options">{stages.map((item) => <button className={item === stage ? "selected" : ""} disabled={item === stage} onClick={() => void changeStage(item)} key={item}><span>{item}</span>{item === stage && <Check size={17} />}</button>)}</div>}
      {sheet === "close" && <form onSubmit={(event) => { event.preventDefault(); void closeLead(event.currentTarget); }}><label>Close reason<select name="closeReason" defaultValue=""><option value="">Select a reason</option>{closeReasons.map((reason) => <option key={reason} value={reason}>{reason.replaceAll("_", " ")}</option>)}</select></label><label>Quality flag (optional)<select name="qualityFlag" defaultValue="">{qualityFlags.map((flag) => <option key={flag || "none"} value={flag}>{flag ? flag.replaceAll("_", " ") : "No additional flag"}</option>)}</select></label><label>Evidence note<textarea name="note" placeholder="Conversation outcome or evidence for this decision" /></label><label>Order value, if bought<input name="orderValue" type="number" min="1" step="1" /></label><label>Original lead ID, if duplicate<input name="linkedLeadId" /></label><button className="primary-form-button">Check evidence and close</button></form>}
      {sheet === "assign" && <form onSubmit={(event) => { event.preventDefault(); void assignLead(event.currentTarget); }}><label>Salesperson<select name="userId" required defaultValue=""><option value="" disabled>Choose a salesperson</option>{assignees.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Reason<textarea name="reason" minLength={5} required placeholder="Why is this lead being reassigned?" /></label><button className="primary-form-button">Assign lead</button></form>}
    </section></div>}
    <MobileBottomNav active="/leads" user={user} />
  </div>;
}
