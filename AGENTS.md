# Working on Lead Response Desk

This repository contains Lead Response Desk. The included tenant is branded as Roopkala Lead Desk. The app receives leads from Google Sheets or Meta, records the salesperson's first Call or WhatsApp tap, runs a business-day follow-up cadence, and gives the owner response and outcome metrics.

This file is written for someone using Codex, Claude Code, Cursor, or another AI coding tool. Ask the agent to read this file and the README before changing or deploying anything.

## Product flow

1. A lead arrives from Google Sheets or Meta Lead Ads.
2. The app deduplicates it and assigns it to an active salesperson. With one active salesperson, that person receives every new lead. If no salesperson is active, the owner receives it.
3. The lead appears in the Today queue. Server time and configured store hours determine the first-response timer.
4. A Call or WhatsApp tap writes an immutable attempt immediately and opens the phone link without waiting.
5. Follow-ups run for the configured number of business days. Missed follow-ups remain visible and do not stop later follow-ups.
6. A lead can move through `new`, `contacted`, `follow_up`, `dormant`, `won`, `dead`, or `bad`.
7. Won requires an order value. Dead `not_interested` and Bad `not_reachable` or `spam` require two attempts on two distinct IST dates. Other canonical reasons are not gated.

## Rules that must never be broken

- `attempts`, `attempt_events`, and `lead_events` are append-only. Never update or delete their history.
- Server timestamps are authoritative. Client timestamps must never control SLA, dashboard, or report calculations.
- The two-attempts/two-days closure rule has one implementation: `src/app/api/leads/[id]/close/route.ts` calls the database function installed by migration `0006`. Do not add a second gate in a domain helper or UI-only check.
- Every application table must have a non-null `tenant_id`, forced row-level security, and at least one RLS policy. `npm run db:verify` must continue to enforce this.
- Add a new numbered migration for every schema change. Never edit an old migration after it has shipped.
- Before every commit, run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. For database changes, also run migrations against a fresh database and run `npm run db:verify`.
- Keep credentials in the server environment. Never put tokens, passwords, private keys, or real client data in source files, documentation, screenshots, tests, or commits.

## Removed features

Do not re-add these without a deliberate product decision and updated tests/documentation:

- Web push, VAPID, browser service workers, or background push alerts
- OTP, SMS, email delivery, magic links, SMTP, Nodemailer, or AiSensy
- Offline mutation queue or PWA/offline mode
- CSV import UI
- Quality-review workflow
- Campaign-management screens
- PDF reports
- Weekly or daily digests
- International-SLA special handling

## Key code locations

- Common intake and deduplication: `src/services/lead-intake.ts`, especially `ingestLead` and `nextAssignee`
- Google Sheet synchronization: `src/services/google-sheets-sync.ts`, especially `persistRows`
- Meta webhook: `src/app/api/webhooks/meta/route.ts`
- Meta adapter and Graph hydration: `src/lead-sources/meta-lead-form/index.ts` and `src/services/meta-leads.ts`
- Meta settings: `src/app/api/integrations/meta/route.ts`, `src/app/api/integrations/meta/test/route.ts`, and `src/components/admin-console.tsx`
- Attempt creation and first touch: `src/app/api/attempts/route.ts`
- Follow-up scheduling and missed processing: `src/services/followups.ts`
- Follow-up answer API: `src/app/api/followups/[id]/route.ts`
- Close gate and outcomes: `src/app/api/leads/[id]/close/route.ts`
- Today queue read model and dashboard metrics: `src/services/product-read-models.ts`
- Today queue UI: `src/components/today-queue.tsx`
- Owner dashboard UI: `src/components/product-dashboard.tsx`

## Connecting to the client's CRM

The client currently has one salesperson, so the existing assignment code already sends every new lead to that person. No integration change is needed for that setup.

If the CRM must choose the salesperson later, add an optional external assignee identifier to `InboundLead` in `src/services/lead-intake.ts`. Map the Sheet column in `src/integrations/google-sheets.ts` and `persistRows` in `src/services/google-sheets-sync.ts`, or accept it in a new authenticated server-to-server API route. Resolve that identifier to an active user in the same tenant inside `ingestLead`; use `nextAssignee` only when no valid external assignee was provided. Never trust a raw user UUID without a tenant and active-role check.

For outbound CRM events, use the append-only records as the source of truth. The relevant write points are `ingestLead` (`lead_received`), `src/app/api/attempts/route.ts` (first attempt), `src/app/api/followups/[id]/route.ts` (`followup_answered`), `src/services/followups.ts` (`followup_missed`), and `src/app/api/leads/[id]/close/route.ts` (`outcome_recorded`). Add an outbox row in the same database transaction, then let the worker deliver it with retries and idempotency. Do not call the CRM synchronously from a user request.

The CRM can read current data through the authenticated `/api/today` and `/api/dashboard?period=today|7|30` routes, or through a new authenticated server-to-server endpoint that calls the read-model functions in `src/services/product-read-models.ts`. Direct database access should be read-only, tenant-scoped, and limited to `app.leads`, `app.attempts`, `app.attempt_events`, `app.lead_events`, and `app.lead_followups`.

## Deploying onto an existing VPS

Follow the README section **Deploying onto a VPS that already runs other apps**. Use `compose.existing-proxy.yaml`, check that the chosen loopback port is free, and add only one site block to the existing reverse proxy. Do not stop, rename, reconfigure, or reuse the existing CRM's containers or database.
