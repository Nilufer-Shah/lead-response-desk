"use client";

import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, LockKeyhole } from "lucide-react";
import Image from "next/image";

const roles = [
  { value: "salesperson", label: "Staff login", help: "My queue, calls, WhatsApp, notes and visits" },
  { value: "owner", label: "Owner login", help: "Live dashboard, all leads and team performance" },
  { value: "admin", label: "Admin login", help: "Users, SLA rules, imports and connections" },
  { value: "agency", label: "Agency login", help: "Read-only campaign and report access" },
] as const;

export function LoginForm({ demoMode, magic }: { demoMode: boolean; magic?: { challengeId: string; token: string } }) {
  const [role, setRole] = useState<(typeof roles)[number]["value"]>("salesperson");
  const [identifier, setIdentifier] = useState("");
  const [challenge, setChallenge] = useState<{ id: string; destination: string; kind: "phone_otp" | "magic_link"; code?: string; developmentLink?: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(Boolean(magic));

  useEffect(() => {
    if (!magic) return;
    void fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challengeId: magic.challengeId, code: magic.token }) })
      .then(async (response) => ({ response, data: await response.json() }))
      .then(({ response, data }) => { if (!response.ok) throw new Error(data.error); window.location.assign(data.redirectTo); })
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : "This sign-in link is invalid or expired"); setBusy(false); });
  }, [magic]);

  async function requestCode() {
    setError("");
    setBusy(true);
    const response = await fetch("/api/auth/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(demoMode ? { role } : { identifier }) });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) return setError(data.error);
    setChallenge({ id: data.challengeId, destination: data.destination, kind: data.kind, code: data.developmentCode, developmentLink: data.developmentLink });
    setCode(data.developmentCode ?? "");
  }

  async function verify() {
    if (!challenge) return;
    setError("");
    setBusy(true);
    const response = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challengeId: challenge.id, code }) });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) return setError(data.error);
    window.location.assign(data.redirectTo);
  }

  return <main className="login-page"><section className="login-brand"><div className="login-logo-lockup"><span className="login-logo-crop"><Image src="/roopkala-logo.webp" alt="Roopkala" width={609} height={336} priority unoptimized /></span><p>Roopkala Lead Desk</p></div><h1>Every lead.<br />Every touch.<br /><span>On the clock.</span></h1><div className="login-proof"><CheckCircle2 /><span>Machine timestamps</span><CheckCircle2 /><span>Immutable activity history</span><CheckCircle2 /><span>Business-hours SLA</span></div></section>
    <section className="login-card"><LockKeyhole size={22} /><div><small>{demoMode ? "Choose your workspace" : "Secure access"}</small><h2>{busy && magic ? "Opening your desk" : challenge?.kind === "magic_link" ? "Check your email" : challenge ? "Enter your code" : demoMode ? "Sign in to Lead Desk" : "Sign in"}</h2><p>{challenge?.kind === "magic_link" ? `We sent a secure sign-in link to ${challenge.destination}.` : challenge ? `We sent a six-digit code to ${challenge.destination}.` : demoMode ? "Each role opens a different workspace. Choose the view you want to test." : "Staff use their phone number. Owners, managers and agency users use their email address."}</p></div>
      {!challenge && demoMode ? <div className="role-list">{roles.map((item) => <button className={role === item.value ? "selected" : ""} onClick={() => setRole(item.value)} key={item.value}><span><strong>{item.label}</strong><small>{item.help}</small></span>{role === item.value && <CheckCircle2 />}</button>)}</div> : !challenge ? <label className="otp-field">Phone number or email<input value={identifier} onChange={(event) => setIdentifier(event.target.value)} inputMode="email" autoComplete="username" placeholder="+91 98765 43210 or name@example.com" /></label> : challenge.kind === "phone_otp" ? <label className="otp-field">Six-digit code<input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" /></label> : challenge.developmentLink ? <a className="login-submit" href={challenge.developmentLink}>Open development magic link<ArrowRight /></a> : null}
      {error && <p className="form-error">{error}</p>}
      {challenge?.kind !== "magic_link" && <button disabled={busy || (!demoMode && !challenge && identifier.length < 3)} className="login-submit" onClick={() => void (challenge ? verify() : requestCode())}>{busy ? "Please wait" : challenge ? "Open lead desk" : "Continue"}<ArrowRight /></button>}
      {challenge && <button className="text-button" onClick={() => setChallenge(null)}>Use a different account</button>}
    </section>
  </main>;
}
