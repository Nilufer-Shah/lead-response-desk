# Lead Response Desk

Lead Response Desk is a standalone, multi-tenant response and follow-up application. The included tenant is branded **Roopkala Lead Desk**.

The operating flow is deliberately small: a lead arrives from Google Sheets or Meta, is assigned round-robin, appears in the salesperson’s Today queue, and starts a five-business-minute response clock. A Call or WhatsApp tap records the first touch without delaying the phone link. Four business-day follow-ups then run until the lead is marked Won, Dead or Bad, or becomes Dormant. Owners and salespeople see period-correct performance metrics; agencies have read-only access.

## Local run

Requirements: Node.js 22+, npm, Docker Engine with Compose.

```sh
cp .env.example .env
# Replace the database passwords, SESSION_SECRET and owner credentials.
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

Open `http://localhost`. The stack contains PostgreSQL 16, a one-shot migration/bootstrap service, Next.js web, a dedicated pg-boss worker and Caddy. The first owner comes from `BOOTSTRAP_OWNER_EMAIL`, `BOOTSTRAP_OWNER_NAME` and `BOOTSTRAP_OWNER_PASSWORD`. Demo leads are loaded only by the explicit `npm run db:seed` command, which refuses to run when `NODE_ENV=production`.

For native development, provide a PostgreSQL database and run:

```sh
npm ci
npm run db:migrate
npm run db:bootstrap
npm run dev
# In another terminal:
npm run dev:worker
```

## Production deployment with Docker Compose and Caddy

1. Point an approved domain at the VPS. Do not buy or change a domain without approval.
2. Copy `.env.example` to `.env`; set `NODE_ENV=production`, `APP_DOMAIN`, matching HTTPS `APP_URL`, unique database passwords, a random 32+ character `SESSION_SECRET`, and the bootstrap owner credentials.
3. Keep `META_CONNECTION_ENABLED=false` until the Meta checklist below is complete.
4. Allow inbound TCP 80 and 443. Do not expose PostgreSQL publicly.
5. Validate and launch:

```sh
NODE_ENV=production npm run launch:check -- --production
docker compose up -d --build
docker compose ps
curl -fsS https://YOUR_APPROVED_DOMAIN/api/health
docker compose run --rm migrate npm run db:verify
```

Caddy obtains TLS certificates and proxies to `web:3000`. Migrations use the database owner. Web and worker use the non-superuser `lead_desk_app` role, so forced row-level security remains active. Deployments are expected to run behind Caddy; do not expose the Next.js container directly.

## Google Sheet setup

1. In Google Cloud, enable the Google Sheets API and create a service account with a JSON key.
2. Put its `client_email` and `private_key` into `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` on the server.
3. Share the active Sheet with the service-account email as **Viewer**. Edit access is not required.
4. Set `GOOGLE_SHEETS_ENABLED=true`, then restart web and worker.
5. Sign in as Owner and open **Settings → Live Google Sheet intake**.
6. Enter the Sheet URL or ID, tab, header row and **Import leads created after** cutoff.
7. Map the columns and test the connection before enabling automatic sync.

Default columns are `external_id`, `meta_lead_id`, `created_at`, `name`, `phone`, `email`, `city`, `campaign` and `ad`. Phone or email is required. `created_at` accepts Indian day-first dates and becomes the lead arrival time; sync time is the fallback. Rows older than the cutoff are skipped entirely. The worker reads new positions every minute and runs a periodic full check for edits. It does not write to the Sheet and has no row cap.

## Meta Lead Ads setup

Meta is implemented but off by default. Complete this on the client’s Business Manager after the app is deployed on HTTPS.

1. Create or select the Meta app inside the client’s Business Manager and attach the Facebook Page and ad account.
2. Create a system user, grant it access to the Page and ad account, and generate a long-lived token with exactly these permissions:
   - `leads_retrieval`
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_metadata`
   - `ads_read`
3. Give the app **Page Leads Access** for the Page.
4. Subscribe the Page to the `leadgen` webhook field.
5. Configure the callback as `https://YOUR_APPROVED_DOMAIN/api/webhooks/meta` and use the private value placed in `META_VERIFY_TOKEN`.
6. Put the app ID, app secret and system-user token in the server `.env`. Tokens are never stored in the database or sent to the browser.
7. In Owner Settings, add each form ID and check or adjust its field mapping.
8. Use **Test connection** in Settings.
9. Submit a test lead with Meta’s Lead Ads Testing Tool and confirm it appears once.
10. Set `META_CONNECTION_ENABLED=true`, restart web and worker, and verify `/api/health`.

Valid webhooks are verified against the raw request body, stored before queueing, hydrated through Graph API, and retried with backoff. A 15-minute reconciliation job checks configured forms for the previous two hours. Sheet and Meta arrivals deduplicate by `meta_lead_id`, or by normalized phone within ten minutes when that ID is absent.

## Users, roles and passwords

- **Owner:** dashboard, all leads, users, store hours and integration settings.
- **Salesperson:** only assigned leads and personal metrics.
- **Agency:** read-only dashboard and leads; database policies block writes.

Owners create, enable, disable and reset users from Settings. Temporary passwords are bcrypt-hashed and require change. Logout revokes the server session. For an emergency owner reset on the server:

```sh
BOOTSTRAP_OWNER_EMAIL=owner@example.com \
OWNER_RESET_PASSWORD='a-new-strong-password' \
npm run owner:reset-password
```

## Data model and guarantees

Every application table has `tenant_id`, forced RLS and at least one policy. `withTenant` supplies tenant, user and role context per transaction. Leads pin their store-hours SLA policy. `attempts`, `attempt_events` and `lead_events` are append-only. Follow-up rows snapshot `assigned_to`, so completed and missed work stays attributed to the salesperson responsible at that time; reassignment moves only pending rows.

Canonical stages are `new`, `contacted`, `follow_up`, `dormant`, `won`, `dead` and `bad`. The only gated outcomes are Dead/`not_interested` and Bad/`not_reachable` or `spam`; they require two attempts on two distinct IST dates.

## Backups

Create an encrypted off-host destination and test restore regularly. Example daily cron entry (run from the repository directory):

```cron
15 2 * * * cd /opt/lead-response-desk && docker compose exec -T postgres pg_dump -U lead_desk_owner -d lead_desk -Fc > /secure-backups/lead-desk-$(date +\%F).dump
```

Example restore into an empty database:

```sh
docker compose exec -T postgres pg_restore -U lead_desk_owner -d lead_desk --clean --if-exists < backup.dump
```

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run launch:check
```

`npm test` uses a disposable local PostgreSQL cluster by default. CI or restricted environments can supply `TEST_DATABASE_URL` pointing to a disposable database. `db:verify` checks the PostgreSQL catalog and fails if an app table lacks non-null `tenant_id`, forced RLS or a policy.

## Known limits

- Sound alerts work only while the Today screen is open and the browser has been enabled by a tap. There is no alert when the phone is locked or the app is closed.
- Push and provider-sent WhatsApp alerts are intentionally absent; they are the suggested next extension if background alerts become necessary.
- Call and WhatsApp taps prove that the link was opened, not that a conversation occurred. Follow-up answers and notes provide the human outcome.
- Google Sheets polling is near-real-time, not instant; the default interval is one minute.
- Meta remains inactive until the HTTPS, Business Manager, token, Page Leads Access and test-lead steps are completed.
- The stack is single-region and does not include managed database failover or object-storage backups.
