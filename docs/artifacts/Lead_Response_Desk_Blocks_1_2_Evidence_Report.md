# Lead Response Desk — Blocks 1 and 2 Evidence Report

**Prepared:** 23 September 2026  
**Repository:** `lead-response-desk`  
**Purpose:** Technical handoff for independent review by Claude  
**Scope:** Evidence-only audit of Blocks 1 and 2. This report does not claim VPS deployment or a live Meta account connection.

## Executive summary

Blocks 1 and 2 are substantially implemented, but they are not fully complete or fully regression-tested. The most important gaps are:

- Today queue has sound and on-screen counters, but no browser/app icon badge and the alert button text differs from the requested copy.
- The first-touch quick-note box is always available rather than being shown specifically after the first touch.
- The reports page still contains a broken link to `/reports/weekly` even though that route was removed.
- Two close-gate implementations coexist: the live API enforces the requested Block 1 two-attempt/two-day rule, while an older domain helper enforces a different three-attempt/WhatsApp/note rule.
- The 10,000-row Google Sheets proof used synthetic/mock rows, not the client's real sheet.
- Several important workflows are coded but do not have dedicated committed behavior tests.
- The real Meta account and VPS deployment are intentionally outside today's scope.

The committed automated suite passes: **7 test files, 27 tests**.

## 1. Requirement checklist

### Block 1

| ID | Status | Evidence paths | Test coverage and notes |
|---|---|---|---|
| 1A | **DONE** | `src/db/schema.ts`; `src/db/migrations/0004_core_product_flow.sql` | `production application contract > uses the exact Block 1 roles and lead stages` |
| 1B | **DONE** | `src/services/lead-intake.ts`; `src/app/api/leads/[id]/assign/route.ts`; `src/db/migrations/0004_core_product_flow.sql` | **No dedicated behavior test.** Round-robin filters disabled/unavailable users and falls back to the owner. Reassignment changes `leads.assigned_to`; pending follow-ups remain attached to the lead, so their visibility follows the new assignee. |
| 1C | **DONE** | `src/app/api/settings/store-hours/route.ts`; `src/components/admin-console.tsx`; `src/domain/sla.ts`; `src/services/lead-intake.ts`; `src/db/migrations/0004_core_product_flow.sql` | `SLA > moves a 21:30 domestic lead to 11:05 the next day`. This is a pure domain test, not an end-to-end API/database test. |
| 1D | **PARTIAL** | `src/components/today-queue.tsx`; `src/services/product-read-models.ts` | **No test.** Three sections, 30-second refresh, sound and visible counts are present. The action says “Turn on lead alerts,” not the exact requested “Tap to enable alerts.” There is no browser/app icon badge. |
| 1E | **PARTIAL** | `src/components/today-queue.tsx`; `src/components/lead-detail.tsx`; `src/app/api/attempts/route.ts`; `src/db/migrations/0004_core_product_flow.sql` | **No test.** Call and WhatsApp use real `<a href>` links. Attempt logging uses `sendBeacon` or keepalive fetch synchronously, without awaiting before navigation. `first_response_minutes` is store-hours adjusted. The quick-note box is always present rather than being revealed specifically after the first touch. |
| 1F | **DONE** | `src/db/migrations/0004_core_product_flow.sql`; `src/services/followups.ts`; `src/app/api/followups/[id]/route.ts`; `src/worker/index.ts` | **No committed automated test; live database proof is documented below.** `lead_followups` has RLS; cadence is configurable from 1–14 days with default 4; both Yes and No require a 10-character note; Yes requires a same-day attempt; missed items are marked at store close; missed does not stop later cadence; lead becomes dormant after the final day. |
| 1G | **DONE** for the Block 1 two-attempt/two-day rule | `src/db/migrations/0004_core_product_flow.sql`; `src/app/api/leads/[id]/close/route.ts`; `src/components/lead-detail.tsx`; `src/services/product-read-models.ts` | **No dedicated automated API test; live proof below.** Won requires value; Dead/Bad require a reason; API enforces two attempts across two days; UI shows live remaining counts; closing cancels pending follow-ups; cancelled follow-ups are excluded from metrics. |
| 1H | **DONE** | `src/services/lead-intake.ts` | **No test.** A repeat dormant enquiry reactivates the lead; a repeat open enquiry logs an event; a repeat closed enquiry creates a new lead. |
| 1I | **DONE** | `src/db/migrations/0004_core_product_flow.sql`; `src/app/api/auth/login/route.ts`; `src/services/bootstrap.ts`; `scripts/reset-owner-password.ts`; `package.json` | `production application contract > uses password hashes and has no OTP sign-in endpoints`. Bcrypt with cost 12 is used. Role migration and reset-password CLI do not have dedicated behavior tests. |
| 1J | **DONE** | `src/integrations/google-sheets.ts`; `src/services/google-sheets.ts`; `src/app/api/admin/google-sheets/route.ts`; `src/components/admin-console.tsx` | Covered by all five Google Sheets tests. Cutoff and skipped counts exist; no 5,000-row cap; `meta_lead_id` mapping exists; day-first dates are parsed in IST. The 10,000-row test is synthetic, not the real client sheet. |
| 1K | **PARTIAL** | `src/components/product-dashboard.tsx`; `src/services/product-read-models.ts`; `src/app/api/dashboard/route.ts`; `src/app/reports/page.tsx` | **No metric-correctness test.** Owner live strip, per-salesperson metrics, Today/7/30 filters and source split exist. There is no `/reports/weekly` route, but the reports page still links to it, so that link is broken. |
| 1L | **DONE** | `scripts/seed.ts` | **No test.** Demo seed was rewritten for the new stages/follow-ups and throws when `NODE_ENV=production`. |

### Block 2

| ID | Status | Evidence paths | Test coverage and notes |
|---|---|---|---|
| 2A | **DONE** | `src/app/api/webhooks/meta/route.ts`; `src/adapters/meta-lead-source.ts`; `src/services/job-queue.ts` | `accepts only a timing-safe sha256 signature`; `stores a valid raw payload, queues it, hydrates it, and ingests it`; `rejects an invalid signature without persisting or queueing`. The raw request body is used for signature verification and persistence precedes queueing. |
| 2B | **DONE** | `src/adapters/meta-lead-source.ts`; `src/services/meta-leads.ts`; `src/services/job-queue.ts` | `maps configurable form fields into the canonical lead`; `hydrates through Graph and surfaces retryable HTTP failures`; `records Graph failure for retry`. `created_time` becomes arrival time; retry/backoff is wired. |
| 2C | **DONE**, primarily static coverage | `src/worker/index.ts`; `src/services/meta-leads.ts`; `src/adapters/meta-lead-source.ts` | `wires persistence-before-queue, retries, reconciliation and cross-source locking`. Reconciliation is scheduled every 15 minutes and only operates when enabled. |
| 2D | **DONE** | `src/db/migrations/0004_core_product_flow.sql`; `src/services/lead-intake.ts` | Committed coverage is source/contract based; the real concurrent database proof is below. Uses an advisory lock, unique `(tenant_id, meta_lead_id)`, and phone plus 10-minute fallback. |
| 2E | **DONE**, partly untested | `src/components/admin-console.tsx`; `src/app/api/admin/meta/route.ts`; `src/app/api/admin/meta/test/route.ts`; `src/env.ts`; `src/db/migrations/0005_meta_env_only.sql` | **No direct settings-UI test.** The Graph tests confirm server-side bearer use. Token is environment-only, never sent to the browser, and a database constraint forces `token_ciphertext` to remain null. |

## 2. Automated tests

### `tests/domain.test.ts`

1. `normalizes Indian numbers and detects international numbers`
2. `moves a 21:30 domestic lead to 11:05 the next day`
3. `uses a continuous five-minute clock for international leads`
4. `blocks two attempts on one day`
5. `allows three attempts over two days including WhatsApp`

### `tests/google-sheets.test.ts`

1. `extracts spreadsheet ID from share URL`
2. `maps values with a configurable header and skips blank rows`
3. `moves a same-external-ID row through the repeat path`
4. `parses Indian day-first timestamps in IST`
5. `maps at least 10,000 rows without truncation`

### `tests/meta-leads.test.ts`

1. `accepts only a timing-safe sha256 signature`
2. `decodes leadgen entries and tolerates malformed payload shapes`
3. `maps configurable form fields into the canonical lead`
4. `hydrates through Graph and surfaces retryable HTTP failures`
5. `wires persistence-before-queue, retries, reconciliation and cross-source locking`

### `tests/meta-pipeline.test.ts`

1. `stores a valid raw payload, queues it, hydrates it, and ingests it`
2. `rejects an invalid signature without persisting or queueing`
3. `records Graph failure for retry`

### `tests/notifications.test.ts`

1. `falls back from WhatsApp to push` — this is legacy/out-of-scope behavior intended for Block 3 removal.

### `tests/production-contract.test.ts`

1. `uses tenant-scoped database read models instead of product mock arrays`
2. `maps every authenticated request into an RLS-scoped database transaction`
3. `does not cache authenticated application pages`
4. `contains no out-of-scope product or client names`
5. `uses the exact Block 1 roles and lead stages`
6. `uses password hashes and has no OTP sign-in endpoints`

### `tests/tenant-security-contract.test.ts`

1. `requires every app table to have a non-null tenant_id`
2. `forces RLS and requires at least one policy for every app table`

### Raw `npm test` output

```text
> lead-response-desk@0.1.0 test
> vitest run


 RUN  v3.2.4 /Users/harsh/Documents/Codex/2026-09-13/new-chat/lead-response-desk

 ✓ tests/tenant-security-contract.test.ts (2 tests) 2ms
 ✓ tests/production-contract.test.ts (6 tests) 7ms
 ✓ tests/notifications.test.ts (1 test) 2ms
 ✓ tests/meta-pipeline.test.ts (3 tests) 10ms
 ✓ tests/google-sheets.test.ts (5 tests) 18ms
 ✓ tests/domain.test.ts (5 tests) 193ms
 ✓ tests/meta-leads.test.ts (5 tests) 6ms

 Test Files  7 passed (7)
      Tests  27 passed (27)
   Start at  22:44:10
   Duration  788ms (transform 300ms, setup 0ms, collect 1.28s, tests 239ms, environment 1ms, prepare 515ms)
```

## 3. Proof runs

These are manual proofs performed against disposable local infrastructure. They are evidence, not committed regression tests.

### A. 10,000-row sheet test

**Result:** Passed with exactly 10,000 mapped rows.  
**Data source:** Synthetic/mock rows generated in the automated test, not real client data.

```text
Command: npm test -- tests/google-sheets.test.ts --reporter=verbose

✓ Google Sheets intake > extracts a spreadsheet ID from a share URL
✓ Google Sheets intake > maps values with a configurable header and skips blank rows
✓ Google Sheets intake > moves a same-external-ID row through the repeat path
✓ Google Sheets intake > parses Indian day-first timestamps in IST
✓ Google Sheets intake > maps at least 10,000 rows without truncation

Test Files  1 passed (1)
Tests       5 passed (5)
```

### B. Concurrent dedupe: Sheet and webhook at the same moment

**Method:** Two concurrent `ingestLead` calls were executed against a disposable PostgreSQL database with the same tenant, phone and `meta_lead_id`; one represented Sheet intake and one Meta webhook intake.

```text
Result:
[
  {"action":"inserted","leadId":"85a72bf7-74cb-491c-ad86-2e03db8ce1ee"},
  {"action":"unchanged","leadId":"85a72bf7-74cb-491c-ad86-2e03db8ce1ee"}
]

Database count for meta_lead_id = meta-proof-concurrent: 1
Stored source: csv_import
Recorded events: source_matched(meta), lead_received(sheet)
```

**Conclusion:** Advisory locking plus uniqueness prevented duplicate lead creation.  
**Limitation:** This was a manual proof and is not a committed regression test.

### C. Follow-up cadence across four days

**Method:** A disposable lead and first attempt were backdated. Days 1, 2 and 4 were prepared as completed answers; day 3 remained pending. `processFollowupCadence` was then executed with a faked current date after store close.

```text
Worker aggregate:
{"due":5,"missed":10,"dormant":6}

Proof lead final stage: dormant

day 1 | done   | yes | note present
day 2 | done   | no  | note present
day 3 | missed | —   | —
day 4 | done   | yes | note present
```

**Conclusion:** A missed day does not stop the cadence, and the lead becomes dormant after day 4.  
**Limitation:** Historical answers were prepared directly in SQL, so this proof does not exercise the API's same-day validation. The API validation is coded but lacks a dedicated committed test.

### D. Close gate: Bad / not reachable

With one attempt on one day:

```http
HTTP/1.1 422 Unprocessable Entity

{
  "error":"1 more contact attempt and 1 more contact day needed",
  "allowed":false,
  "attempts":1,
  "distinct_days":1,
  "required_days":2,
  "required_attempts":2
}
```

After adding a second attempt on a different day and repeating the same request:

```http
HTTP/1.1 200 OK

{"ok":true}
```

**Conclusion:** The live close API enforces the Block 1 two-attempt/two-day rule.

### E. Tenant security / RLS catalog audit

The catalog check covers every `app` table, including `lead_followups`. Every row below has non-null `tenant_id`, RLS enabled, RLS forced, and at least one policy.

| Table | tenant_id NOT NULL | RLS enabled | RLS forced | Policy count |
|---|---:|---:|---:|---:|
| assignment_rules | YES | YES | YES | 1 |
| attempt_events | YES | YES | YES | 3 |
| attempts | YES | YES | YES | 3 |
| audit_log | YES | YES | YES | 1 |
| auth_challenges | YES | YES | YES | 1 |
| business_hours | YES | YES | YES | 1 |
| daily_metrics | YES | YES | YES | 1 |
| form_field_map | YES | YES | YES | 1 |
| google_sheet_connections | YES | YES | YES | 1 |
| google_sheet_sync_runs | YES | YES | YES | 1 |
| import_rows | YES | YES | YES | 1 |
| imports | YES | YES | YES | 1 |
| job_events | YES | YES | YES | 1 |
| jobs | YES | YES | YES | 1 |
| lead_events | YES | YES | YES | 3 |
| lead_followups | YES | YES | YES | 5 |
| lead_sla_cycles | YES | YES | YES | 1 |
| leads | YES | YES | YES | 5 |
| meta_ad_cache | YES | YES | YES | 1 |
| meta_connections | YES | YES | YES | 1 |
| notes | YES | YES | YES | 3 |
| notifications | YES | YES | YES | 1 |
| reports | YES | YES | YES | 1 |
| sessions | YES | YES | YES | 1 |
| sla_policies | YES | YES | YES | 1 |
| source_connections | YES | YES | YES | 1 |
| source_forms | YES | YES | YES | 1 |
| store_holidays | YES | YES | YES | 1 |
| stores | YES | YES | YES | 1 |
| targets | YES | YES | YES | 1 |
| tenants | YES | YES | YES | 1 |
| user_store_memberships | YES | YES | YES | 1 |
| users | YES | YES | YES | 1 |
| webhook_events | YES | YES | YES | 1 |
| webhook_processing_events | YES | YES | YES | 1 |

Catalog query used:

```sql
SELECT
  c.relname AS table_name,
  CASE WHEN a.attnotnull THEN 'YES' ELSE 'NO' END AS tenant_id_not_null,
  CASE WHEN c.relrowsecurity THEN 'YES' ELSE 'NO' END AS rls_enabled,
  CASE WHEN c.relforcerowsecurity THEN 'YES' ELSE 'NO' END AS rls_forced,
  count(p.polname) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'app' AND c.relkind = 'r'
GROUP BY c.relname, a.attnotnull, c.relrowsecurity, c.relforcerowsecurity
ORDER BY c.relname;
```

## 4. Honesty check

### Built differently from the requested specification

1. The Today queue has visible counters, not a browser/app icon badge.
2. The alerts button copy is “Turn on lead alerts,” not the exact requested “Tap to enable alerts.”
3. The lead quick-note box is always visible; it is not specifically revealed immediately after first touch.
4. `/reports/weekly` is removed, but a stale link remains on the reports page.
5. There are two close-gate implementations:
   - the live close API uses two attempts across two distinct days for Bad/not reachable;
   - `src/domain/close-gate.ts` still carries a different three-attempt/WhatsApp/note rule and is not used by that API.
6. Some Dead/Bad reason values differ from the canonical Amendment 1.1 lists and need normalization.
7. Follow-up reassignment is achieved indirectly through lead ownership rather than rewriting every pending follow-up row.

### Coded but not fully tested

- Round-robin assignment, disabled-user skipping, owner fallback and reassignment behavior.
- Repeat-enquiry behavior across dormant, open and closed states.
- Full store-hours settings API and UI behavior.
- Browser sound-permission and alert behavior.
- Attempt-before-navigation behavior in a real browser.
- End-to-end first-response calculation in the database.
- Follow-up response API constraints, including the Yes/same-day requirement.
- Dashboard/report metric correctness across all date filters.
- Owner password-reset CLI behavior.
- Production seed refusal.
- Reconciliation timer behavior and retry/backoff are covered partly by static contract tests rather than a live worker clock.
- Real Meta Graph access has not been tested because the real Meta account is intentionally not connected yet.

### Test-data qualifications

- The 10,000-row Sheets test is synthetic, not the client's live Google Sheet.
- The Meta pipeline tests use mocked Graph responses, not the live Meta account.
- The four-day follow-up proof used direct SQL to prepare historical rows and proves worker/dormancy behavior, not the full API journey.
- One of the 27 tests (`falls back from WhatsApp to push`) covers legacy functionality that is scheduled for Block 3 removal.

## 5. Scope and required next order

Deployment to the VPS and connection to the real Meta account are **not in scope for today's implementation proof**. The client's team can complete those steps from the README; the implementation should not wait on them.

The agreed next sequence is:

1. Block 3 removal first.
2. Docker fresh-volume boot.
3. Fifteen-step smoke test.
4. Block 4 handoff.

## Final assessment

Blocks 1 and 2 are **substantially implemented and the current automated suite is green**, but the project is not yet honestly describable as fully complete. The partial requirements, stale report link, dual gate logic, reason-list drift and untested behavior listed above should be addressed before final acceptance.
