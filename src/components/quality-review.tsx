"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, RotateCcw, ShieldAlert, XCircle } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import type { QualityCase } from "@/domain/read-models";

export function QualityReview({ user, rows }: { user: SessionUser; rows: QualityCase[] }) {
  const [decisions, setDecisions] = useState<Record<string, "approved" | "returned">>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const canReview = (["owner", "admin", "manager"] as string[]).includes(user.role);
  const ready = rows.filter((row) => row.status === "Ready for review" || row.status === "Approved").length;
  const failed = rows.filter((row) => row.status === "Gate failed" || row.status === "Returned").length;

  async function decide(id: string, decision: "approved" | "returned") {
    const response = await fetch(`/api/leads/${id}/quality-review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
    if (response.ok) setDecisions((current) => ({ ...current, [id]: decision }));
  }

  return <>
    <div className="summary-cards"><article><ShieldAlert /><div><strong>{rows.length}</strong><small>Flagged this period</small></div></article><article><XCircle /><div><strong>{failed}</strong><small>Do not meet the gate</small></div></article><article><CheckCircle2 /><div><strong>{ready}</strong><small>Ready for owner review</small></div></article></div>
    <section className="quality-mobile-list">{rows.map((row) => {
      const decision = decisions[row.id];
      return <article className="quality-case" key={row.id}><button className="quality-case-head" onClick={() => setExpanded(expanded === row.id ? null : row.id)}><span><strong>{row.name}</strong><small>{row.flag} · {row.attempts}</small></span><span className={decision === "approved" ? "gate-ready" : decision === "returned" || row.status === "Gate failed" ? "gate-failed" : "gate-ready"}>{decision === "approved" ? "Approved" : decision === "returned" ? "Returned" : row.status}</span><ChevronDown size={17} /></button>{expanded === row.id && <div className="quality-case-body"><dl><div><dt>Attempt spread</dt><dd>{row.days}</dd></div><div><dt>WhatsApp evidence</dt><dd>{row.whatsapp}</dd></div><div><dt>Salesperson note</dt><dd>{row.note}</dd></div></dl>{canReview && row.status !== "Gate failed" && <div><button onClick={() => void decide(row.id, "returned")}><RotateCcw size={15} />Return for evidence</button><button onClick={() => void decide(row.id, "approved")}><CheckCircle2 size={15} />Approve claim</button></div>}</div>}</article>;
    })}</section>
    <section className="panel quality-panel quality-desktop-table"><div className="panel-title"><div><h2>Claims and attempt evidence</h2><p>Select a row on mobile to review the evidence and decide</p></div></div><div className="table-scroll"><table><thead><tr><th>Lead</th><th>Claim</th><th>Attempts</th><th>Spread</th><th>WhatsApp</th><th>Note</th><th>Gate</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.flag}</td><td>{row.attempts}</td><td>{row.days}</td><td>{row.whatsapp}</td><td>{row.note}</td><td><span className={decisions[row.id] === "approved" ? "gate-ready" : decisions[row.id] === "returned" || row.status === "Gate failed" ? "gate-failed" : "gate-ready"}>{decisions[row.id] === "approved" ? "Approved" : decisions[row.id] === "returned" ? "Returned" : row.status}</span></td></tr>)}</tbody></table></div></section>
    <section className="gate-explainer"><h2>A claim must be earned</h2><p>Unreachable, no response, spam, wrong person, budget mismatch and competitor require three attempts over two days, including a WhatsApp send attempt and a meaningful note.</p></section>
  </>;
}
