"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, Database, FileSpreadsheet, Link2Off, RefreshCw, Save, ShieldCheck, Upload, UserPlus, UsersRound } from "lucide-react";

const defaultMapping = { externalId: "external_id", createdAt: "created_at", fullName: "name", phone: "phone", email: "email", city: "city", campaignName: "campaign", adName: "ad" };
type SheetState = { demo: boolean; credentialsConfigured: boolean; serviceAccountEmail: string | null; enabledByEnvironment: boolean; connection: null | { id: string; spreadsheet_id: string; sheet_name: string; header_row: number; mapping: typeof defaultMapping; enabled: boolean; last_synced_at: string | null; last_healthy_at: string | null; last_error: string | null }; runs: Array<{ id: string; status: string; rows_seen: number; inserted_rows: number; repeat_rows: number; rejected_rows: number; started_at: string; error: string | null }> };
type UserRow = { id: string; display_name: string; phone_e164: string | null; email: string | null; role: string; status: string; available: boolean };

export function AdminConsole() {
  const [importResult, setImportResult] = useState<string | null>(null);
  const [sheetState, setSheetState] = useState<SheetState | null>(null);
  const [sheetForm, setSheetForm] = useState({ spreadsheet: "", sheetName: "Leads", headerRow: 1, enabled: false, mapping: defaultMapping });
  const [sheetMessage, setSheetMessage] = useState<string | null>(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [userForm, setUserForm] = useState({ displayName: "", role: "salesperson", phone: "", email: "" });
  const [userMessage, setUserMessage] = useState<string | null>(null);

  async function loadSheetState() {
    const response = await fetch("/api/integrations/google-sheets", { cache: "no-store" });
    const data = await response.json() as SheetState & { error?: string };
    if (!response.ok) { setSheetMessage(data.error ?? "Could not load Google Sheets settings"); return; }
    setSheetState(data);
    if (data.connection) setSheetForm({ spreadsheet: data.connection.spreadsheet_id, sheetName: data.connection.sheet_name, headerRow: data.connection.header_row, enabled: data.connection.enabled, mapping: { ...defaultMapping, ...data.connection.mapping } });
  }

  async function loadUsers() {
    const response = await fetch("/api/admin/users", { cache: "no-store" });
    const data = await response.json() as { users?: UserRow[]; error?: string };
    if (response.ok) setUsers(data.users ?? []); else setUserMessage(data.error ?? "Could not load users");
  }

  useEffect(() => { void loadSheetState(); void loadUsers(); }, []);

  async function addUser(event: React.FormEvent) {
    event.preventDefault(); setUserMessage(null);
    const response = await fetch("/api/admin/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(userForm) });
    const data = await response.json() as { error?: string; demo?: boolean };
    if (!response.ok) return setUserMessage(data.error ?? "User could not be added");
    setUserMessage(data.demo ? "User details validated in demo mode." : "User added and can now sign in.");
    setUserForm({ displayName: "", role: "salesperson", phone: "", email: "" });
    await loadUsers();
  }

  async function toggleUser(item: UserRow) {
    const response = await fetch(`/api/admin/users/${item.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: item.status === "active" ? "disabled" : "active" }) });
    if (response.ok) await loadUsers();
  }

  async function sheetAction(action: "save" | "test" | "sync") {
    setSheetBusy(true); setSheetMessage(null);
    const endpoint = action === "save" ? "/api/integrations/google-sheets" : `/api/integrations/google-sheets/${action}`;
    const response = await fetch(endpoint, { method: action === "save" ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sheetForm) });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) setSheetMessage(String(data.error ?? `${action} failed`));
    else if (action === "test") setSheetMessage(`Connected. ${data.rowCount} lead rows found. Headers: ${((data.headers as string[]) ?? []).join(", ")}.`);
    else if (action === "sync") setSheetMessage(`Sync complete: ${data.inserted} new, ${data.repeats} repeat, ${data.unchanged} unchanged, ${data.rejected} rejected.`);
    else setSheetMessage(String(data.message ?? "Google Sheets settings saved."));
    setSheetBusy(false);
    if (response.ok) await loadSheetState();
  }

  async function importCsv(file?: File) {
    if (!file) return;
    const body = new FormData(); body.set("file", file);
    const response = await fetch("/api/imports/csv", { method: "POST", body });
    const data = await response.json();
    setImportResult(response.ok ? (data.importId ? `${data.inserted} leads imported, ${data.repeats} repeat enquiries linked, ${data.rejected} rows rejected.` : `${data.rows} rows validated. ${data.valid} are ready to import.`) : data.error);
  }

  return <div className="admin-grid">
    <section className="panel admin-card"><header><Database /><div><h2>Tenant and data</h2><p>Dedicated database · India region</p></div><span className="healthy-tag">Ready</span></header><dl><div><dt>Client-facing name</dt><dd>Roopkala Lead Desk</dd></div><div><dt>Timezone</dt><dd>Asia/Kolkata</dd></div><div><dt>Currency</dt><dd>INR</dd></div><div><dt>Tenant isolation</dt><dd>RLS enforced</dd></div></dl></section>
    <section className="panel admin-card"><header><Clock3 /><div><h2>SLA policy v1</h2><p>Effective 1 January 2026</p></div><span className="healthy-tag">Immutable</span></header><dl><div><dt>Domestic target</dt><dd>5 business minutes</dd></div><div><dt>International target</dt><dd>5 continuous minutes</dd></div><div><dt>Domestic escalations</dt><dd>15m · 60m · 240m</dd></div><div><dt>International escalations</dt><dd>30m · 120m</dd></div></dl></section>
    <section className="panel admin-card meta-deferred"><header><Link2Off /><div><h2>Meta Lead Ads</h2><p>Connection intentionally left until last</p></div><span>Deferred</span></header><p className="admin-note">The adapter, encrypted connection record, field mapping, hydration queue and reconciliation jobs are ready. No token or Page has been connected.</p><button disabled>Connect Meta after approval</button></section>
    <section className="panel admin-card wide sheets-card"><header><FileSpreadsheet /><div><h2>Live Google Sheets intake</h2><p>Checks the active sheet every minute and adds only new enquiries</p></div><span className={sheetState?.credentialsConfigured ? "healthy-tag" : "setup-tag"}>{sheetState?.credentialsConfigured ? "Credentials ready" : "Setup needed"}</span></header>
      <div className="sheet-steps"><span><b>1</b>Create a Google service account</span><span><b>2</b>Share the Sheet as Viewer with {sheetState?.serviceAccountEmail ?? "the service account email"}</span><span><b>3</b>Save, test, then enable sync</span></div>
      <div className="sheet-form">
        <label className="wide-field">Google Sheets URL or ID<input value={sheetForm.spreadsheet} onChange={(event) => setSheetForm((value) => ({ ...value, spreadsheet: event.target.value }))} placeholder="https://docs.google.com/spreadsheets/d/…" /></label>
        <label>Sheet tab<input value={sheetForm.sheetName} onChange={(event) => setSheetForm((value) => ({ ...value, sheetName: event.target.value }))} /></label>
        <label>Header row<input type="number" min="1" max="100" value={sheetForm.headerRow} onChange={(event) => setSheetForm((value) => ({ ...value, headerRow: Number(event.target.value) }))} /></label>
        {Object.entries(sheetForm.mapping).map(([key, value]) => <label key={key}>{key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())} column<input value={value} onChange={(event) => setSheetForm((current) => ({ ...current, mapping: { ...current.mapping, [key]: event.target.value } }))} /></label>)}
        <label className="sheet-toggle wide-field"><input type="checkbox" checked={sheetForm.enabled} onChange={(event) => setSheetForm((value) => ({ ...value, enabled: event.target.checked }))} /><span>Enable automatic one-minute sync after saving</span></label>
      </div>
      <div className="sheet-actions"><button onClick={() => void sheetAction("save")} disabled={sheetBusy}><Save />Save settings</button><button onClick={() => void sheetAction("test")} disabled={sheetBusy || !sheetState?.credentialsConfigured}><CheckCircle2 />Test connection</button><button onClick={() => void sheetAction("sync")} disabled={sheetBusy || !sheetState?.connection?.enabled}><RefreshCw />Sync now</button></div>
      {sheetMessage && <p className="sheet-message">{sheetMessage}</p>}
      {sheetState?.demo && <p className="admin-note">You are viewing demo mode. The form can be validated, but production mode and PostgreSQL are required to save or run the sync.</p>}
      {sheetState?.connection?.last_error && <p className="sheet-error">Last sync error: {sheetState.connection.last_error}</p>}
      {sheetState?.runs?.length ? <div className="sync-history"><strong>Recent syncs</strong>{sheetState.runs.map((run) => <span key={run.id}><i className={run.status} />{new Date(run.started_at).toLocaleString("en-IN")} · {run.status} · {run.inserted_rows} new · {run.repeat_rows} repeat · {run.rejected_rows} rejected</span>)}</div> : null}
    </section>
    <section className="panel admin-card wide users-card"><header><UsersRound /><div><h2>Users and access</h2><p>Manage staff, managers, owners, agency viewers and administrators</p></div><span className="healthy-tag">{users.filter((item) => item.status === "active").length} active</span></header>
      <form className="user-create-form" onSubmit={(event) => void addUser(event)}><label>Name<input required minLength={2} value={userForm.displayName} onChange={(event) => setUserForm((value) => ({ ...value, displayName: event.target.value }))} /></label><label>Role<select value={userForm.role} onChange={(event) => setUserForm((value) => ({ ...value, role: event.target.value }))}><option value="salesperson">Salesperson</option><option value="manager">Manager</option><option value="owner">Owner</option><option value="agency">Agency viewer</option><option value="admin">Administrator</option></select></label>{userForm.role === "salesperson" ? <label>Phone<input required inputMode="tel" value={userForm.phone} onChange={(event) => setUserForm((value) => ({ ...value, phone: event.target.value }))} placeholder="+91 98765 43210" /></label> : <label>Email<input required type="email" value={userForm.email} onChange={(event) => setUserForm((value) => ({ ...value, email: event.target.value }))} placeholder="name@example.com" /></label>}<button><UserPlus />Add user</button></form>
      {userMessage && <p className="sheet-message">{userMessage}</p>}
      <div className="user-list">{users.map((item) => <div key={item.id}><span className="person-dot">{item.display_name[0]}</span><span><strong>{item.display_name}</strong><small>{item.role.replaceAll("_", " ")} · {item.phone_e164 ?? item.email}</small></span><em className={item.status === "active" ? "healthy-tag" : "setup-tag"}>{item.status}</em><button onClick={() => void toggleUser(item)}>{item.status === "active" ? "Disable" : "Enable"}</button></div>)}</div>
    </section>
    <section className="panel admin-card" id="imports"><header><FileSpreadsheet /><div><h2>CSV history import</h2><p>Backfill the existing lead sheet</p></div></header><label className="upload-box"><Upload /><strong>Select a CSV file</strong><small>Name, phone, email, city and created_at are recognized automatically.</small><input type="file" accept=".csv,text/csv" onChange={(event) => void importCsv(event.target.files?.[0])} /></label>{importResult && <p className="import-result"><CheckCircle2 />{importResult}</p>}</section>
    <section className="panel admin-card wide"><header><ShieldCheck /><div><h2>Integrity controls</h2><p>Evidence cannot be rewritten</p></div></header><div className="integrity-list"><span><CheckCircle2 />Lead events are append-only</span><span><CheckCircle2 />Attempts and outcomes are append-only</span><span><CheckCircle2 />Policy versions never change in place</span><span><CheckCircle2 />Daily metrics retain prior versions</span><span><CheckCircle2 />Every product table has tenant RLS</span><span><CheckCircle2 />Client timestamps never affect metrics</span></div></section>
  </div>;
}
