# Lead Response Desk

Lead Response Desk is a standalone, multi-tenant response and follow-up application. The included tenant is branded **Roopkala Lead Desk**.

The operating flow is deliberately small: a lead arrives from Google Sheets or Meta, is assigned round-robin, appears in the salesperson’s Today queue, and starts a five-business-minute response clock. A Call or WhatsApp tap records the first touch without delaying the phone link. Four business-day follow-ups then run until the lead is marked Won, Dead or Bad, or becomes Dormant. Owners and salespeople see period-correct performance metrics; agencies have read-only access.

## Local run

Requirements: Node.js 22, npm 10+, Docker Engine with Compose. The repository pins Node 22 in `.nvmrc` and `package.json`.

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

## What is already built, and what the agency activates after deployment

The production users, Google Sheet intake, and Meta Lead Ads connection are **already implemented in this repository**. They are not unfinished product features. They are deliberately shipped without the client's live credentials because passwords, private keys, access tokens, Sheet IDs, Page IDs, and form IDs must never be committed to Git.

After the app is deployed, the agency will request temporary access from the client and complete the activation on the client's VPS and accounts:

1. Create the client's real Owner, Salesperson, and optional Agency users, then give each person their own temporary password to change at first sign-in.
2. Add the Google service-account credentials only to the server `.env`, share the client's active Sheet with that service account, map the live columns in Owner Settings, test the connection, and enable automatic sync.
3. When the client is ready for Meta, use temporary Business Manager access to add the Page, forms, system-user token, webhook, and field mappings; run a test lead; then enable Meta intake.
4. If the client wants Lead Response Desk connected to the existing CRM, use the documented API/event extension points in **Connecting to the client's CRM**. The two applications remain separate and must not share a database.

The client does not need to rebuild these capabilities. Until the agency receives temporary access and completes the above configuration, the application can run and be reviewed, but it will not ingest the client's private live Sheet or Meta leads. Never send credentials in chat, documentation, source code, or GitHub; place them directly in the production server environment.

## Production deployment with Docker Compose and Caddy

1. Point an approved domain at the client's VPS. Do not buy or change a domain without approval.
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

## Deploying onto a VPS that already runs other apps

Use this layout when the client's VPS already has a CRM or another application behind nginx, Caddy, Traefik, or a similar reverse proxy. Ports 80 and 443 are probably already owned by that proxy, so do not start the bundled Lead Response Desk Caddy service and do not bind this app directly to a public interface.

`compose.existing-proxy.yaml` keeps Lead Response Desk in its own Compose project, starts its own PostgreSQL container, migrations, web process, and worker, and binds the web container only to the client's VPS loopback interface. The default host port is `3010`; change `LRD_WEB_PORT` only after checking which ports are free.

```sh
# From the Lead Response Desk repository on the client's VPS:
ss -ltnp
cp .env.example .env
# Fill .env with production values. Set APP_URL to the final HTTPS subdomain.
export LRD_WEB_PORT=3010
NODE_ENV=production npm run launch:check -- --production
docker compose -f compose.yaml -f compose.existing-proxy.yaml \
  up -d --build postgres migrate web worker
curl -fsS http://127.0.0.1:${LRD_WEB_PORT}/api/health
docker compose -f compose.yaml -f compose.existing-proxy.yaml \
  run --rm migrate npm run db:verify
```

The override places the base `caddy` service behind an inactive profile and publishes only `127.0.0.1:${LRD_WEB_PORT}:3000`. Do not add `caddy` to the `up` command. Keep the Compose project name `lead-response-desk` so its containers, network, and volumes stay separate from the CRM.

Lead Response Desk must use its own `postgres` container, `lead_desk` database, users, volume, migrations, and backups. Do not point `DATABASE_URL` at the CRM database and do not reuse the CRM's database credentials.

### nginx site block

Replace the domain and certificate paths. Add this as a new site; do not rewrite the existing CRM site.

```nginx
server {
    listen 80;
    server_name leads.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name leads.example.com;

    ssl_certificate /etc/letsencrypt/live/leads.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/leads.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

Test with `nginx -t` before reloading nginx. If Certbot manages this server, obtain the certificate for the new subdomain using the existing process on the client's VPS.

### Caddy site block

Caddy obtains and renews HTTPS automatically when the domain points to the client's VPS and ports 80/443 reach Caddy.

```caddyfile
leads.example.com {
    reverse_proxy 127.0.0.1:3010
}
```

Validate with `caddy validate --config /path/to/Caddyfile` before reloading the existing Caddy process.

**Tell your AI agent:** "Deploy Lead Response Desk with `compose.yaml` plus `compose.existing-proxy.yaml`. Check free ports first and bind the app to `127.0.0.1`. Do not stop, rename, edit, or reuse the existing CRM's containers, network, volumes, or database. Change the existing reverse proxy only by adding one new site block for the Lead Response Desk subdomain, validate its configuration, then test `/api/health`."

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

## Connecting to the client's CRM

The CRM and Lead Response Desk remain separate applications and separate databases. Integrate through explicit identifiers, authenticated APIs, or an event webhook; do not share database credentials or import CRM migrations.

### Assignment supplied by the CRM

The client currently has one salesperson. The existing `nextAssignee` function in `src/services/lead-intake.ts` therefore assigns every new lead to that person, so nothing needs to change for the current team.

If the CRM later needs to choose the assignee:

1. Add an optional external assignee identifier to `InboundLead` in `src/services/lead-intake.ts`.
2. For Sheets, add an `assignedTo` column to the mapping schema in `src/integrations/google-sheets.ts`, expose it in `src/components/admin-console.tsx`, and pass its value from `persistRows` in `src/services/google-sheets-sync.ts`.
3. For API delivery, add a server-to-server route protected by a dedicated secret or signed request and pass the identifier to `ingestLead`.
4. Inside `ingestLead`, resolve the external identifier to an active `salesperson` in the same tenant. Use `nextAssignee` only when no valid external assignment is supplied. Never accept an unchecked database UUID from the CRM.
5. Keep reassignment behavior unchanged: only pending follow-up rows move to the new salesperson; completed and missed rows keep their original `assigned_to`.

### Outbound events to the CRM

Do not send CRM webhooks synchronously from page or API requests. Add a new migration for a tenant-scoped outbox table with forced RLS, insert an outbox row in the same transaction as the source event, and have `src/worker/index.ts` deliver signed webhooks with an idempotency key, retry/backoff, attempt count, last error, and delivered timestamp.

Use these exact source points:

- `lead_received`: after the `lead_events` insert in `ingestLead` in `src/services/lead-intake.ts`.
- `first_touch`: after the attempt insert in `src/app/api/attempts/route.ts`, only when `firstAttempt` is true.
- `followup_answered`: after the event insert in `src/app/api/followups/[id]/route.ts`.
- `followup_missed`: after the event insert in `src/services/followups.ts`.
- `outcome`: after `outcome_recorded` in `src/app/api/leads/[id]/close/route.ts`.

Every webhook envelope should contain `eventId`, `eventType`, `tenantId`, `leadId`, `occurredAt`, and `schemaVersion`. Event-specific fields already available at those write points are:

- `lead_received`: `source`, `externalId`, `arrivedAt`, `assignedTo`, form/campaign/ad identifiers, and source metadata.
- `first_touch`: `attemptId`, `userId`, `channel`, server `initiatedAt`, `firstResponseMinutes`, and current stage.
- `followup_answered`: `followupId`, `dayNumber`, `answer`, `note`, optional `attemptId`, and `answeredBy`.
- `followup_missed`: `followupId` and `dayNumber`; assignee and lead details can be joined from `lead_followups` and `leads`.
- `outcome`: `outcome`, `reason`, optional `note`, optional `orderValue`, and the acting user.

### Data the CRM can read

- `GET /api/today` returns the signed-in salesperson's new, due, and missed queues.
- `GET /api/dashboard?period=today`, `?period=7`, or `?period=30` returns live owner figures and period metrics.
- Current application screens call `getLeadList`, `getLeadDetail`, `getTodayQueue`, and `getProductDashboard` in `src/services/product-read-models.ts`. A future CRM API should call these read models under a dedicated tenant-scoped service identity rather than copying their SQL.
- If the CRM is given direct database reporting access, create a read-only PostgreSQL role and restrict it to tenant-filtered views over `app.leads`, `app.attempts`, `app.attempt_events`, `app.lead_events`, and `app.lead_followups`. Do not give it the owner or runtime app role.

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
- `npm audit --omit=dev` currently reports two transitive PostCSS advisories through Next.js (one moderate and one high). npm reports no available fix. The app does not accept or compile user-supplied CSS, so exposure is low; track the upstream Next.js fix and upgrade normally when it is released rather than forcing an incompatible override.
