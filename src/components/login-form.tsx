"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, LockKeyhole } from "lucide-react";
import Image from "next/image";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setError(""); setBusy(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.text();
      const data = body ? JSON.parse(body) as { error?: string; redirectTo?: string } : {};
      if (!response.ok) return setError(data.error ?? "The sign-in service is temporarily unavailable");
      window.location.assign(data.redirectTo ?? "/");
    } catch {
      setError("The sign-in service is temporarily unavailable. Please try again.");
    } finally { setBusy(false); }
  }

  return <main className="login-page"><section className="login-brand"><div className="login-logo-lockup"><span className="login-logo-crop"><Image src="/roopkala-logo.webp" alt="Roopkala" width={609} height={336} priority unoptimized /></span><p>Roopkala Lead Desk</p></div><h1>Every lead.<br />Every touch.<br /><span>On the clock.</span></h1><div className="login-proof"><CheckCircle2 /><span>Server timestamps</span><CheckCircle2 /><span>Immutable activity history</span><CheckCircle2 /><span>Business-hours response timing</span></div></section>
    <section className="login-card"><LockKeyhole size={22} /><div><small>Secure access</small><h2>Sign in</h2><p>Use the email and password provided by the owner.</p></div>
      <form onSubmit={(event) => void login(event)}>
        <label className="otp-field">Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" placeholder="name@example.com" /></label>
        <label className="otp-field">Password<input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
        {error && <p className="form-error">{error}</p>}
        <button disabled={busy} className="login-submit">{busy ? "Signing in…" : "Open lead desk"}<ArrowRight /></button>
      </form>
    </section>
  </main>;
}
