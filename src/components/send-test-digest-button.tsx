"use client";

import { useState } from "react";
import { CheckCircle2, Send } from "lucide-react";

export function SendTestDigestButton() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  async function send() {
    setStatus("sending");
    const response = await fetch("/api/reports/digest/test", { method: "POST" });
    setStatus(response.ok ? "sent" : "error");
  }
  return <button onClick={() => void send()} disabled={status === "sending"}>{status === "sent" ? <CheckCircle2 size={16} /> : <Send size={16} />}{status === "sending" ? "Queuing…" : status === "sent" ? "Digest queued" : status === "error" ? "Try again" : "Send test digest"}</button>;
}
