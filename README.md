# Lead Response Desk

Standalone, multi-tenant lead response application. Tenant-facing product copy is configured per tenant; the included seed renders **Roopkala Lead Desk**.

Meta Lead Ads is intentionally disabled for this build stage. CSV upload and read-only Google Sheets polling are the active ingestion paths. The Meta adapter, schema boundary, connection status, and disabled worker schedules are present so the connection can be completed last without changing the core data model.

## Local development

Requirements: Node.js 22, npm, Docker with Compose for the full stack.

```sh
cp .env.example .env
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

The stack contains Caddy, a Next.js web process, a dedicated pg-boss worker, the one-shot migration process, and PostgreSQL 16. Migrations use a database-owner account; web and worker processes use the non-superuser `lead_desk_app` role so forced RLS cannot be bypassed. Caddy serves the configured `APP_DOMAIN`; do not purchase or change a domain before approval.

For UI-only development without Docker:

```sh
npm ci
npm run dev
```

Demo mode exposes role-based sample access. Production mode (`DEMO_MODE=false`) requires authenticated sessions and tenant context.

On a fresh production database the migration service also runs `db:bootstrap`. It creates or reactivates exactly one administrator from `BOOTSTRAP_ADMIN_EMAIL` without loading demo leads. That administrator signs in by email magic link and can add staff, owners, managers, agency viewers, and additional administrators from Settings.

## Live Google Sheets intake

The connection uses a Google Cloud service account and read-only Sheets access. The private key remains in server environment variables and is never stored in the database or sent to the browser.

1. Create a Google Cloud project, enable the Google Sheets API, and create a service account with a JSON key.
2. Put the service account `client_email` and `private_key` into `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` in `.env`.
3. Share the active Google Sheet as **Viewer** with the service account email.
4. Set `GOOGLE_SHEETS_ENABLED=true`, restart the web and worker services, then sign in as Owner or Admin.
5. Open Settings → Live Google Sheets intake. Enter the Sheet URL, tab name, header row, and column names. Test the connection before enabling automatic sync.

The worker checks the sheet every minute by default. It never edits the Sheet. Rows receive deterministic external IDs, so moving a row does not duplicate it. Existing phone numbers are recorded as repeat enquiries. New rows use the canonical `csv_import` source and retain Google Sheet, tab, row, and content-hash provenance in `custom_fields`.

Expected default columns are `external_id`, `created_at`, `name`, `phone`, `email`, `city`, `campaign`, and `ad`. Only a phone or email is mandatory. A stable `external_id` is recommended; when it is absent, the connector derives one from phone/email and creation time.

## Verification

```sh
npm run lint
npm run typecheck
npm run test
npm run build
npm run launch:check
```

With PostgreSQL running:

```sh
npm run db:migrate
npm run db:seed
npm run db:verify
```

`db:verify` queries PostgreSQL's catalogs and fails if any application table lacks a non-null `tenant_id`, forced row-level security, or at least one RLS policy. CI runs the same assertion against PostgreSQL 16.

Before production deployment, run `NODE_ENV=production npm run launch:check -- --production`. The check rejects demo mode, insecure/public-local URLs, placeholder session secrets, incomplete Google credentials, and an accidentally enabled Meta connection.

## Repository map

- `src/app`: role-specific web surfaces and API routes
- `src/db`: Drizzle schema and ordered SQL migrations
- `src/domain`: SLA, normalization, and closure-gate rules
- `src/lead-sources`: source adapter contract, CSV implementation, deferred Meta boundary
- `src/integrations`: authenticated, read-only Google Sheets client and row mapping
- `src/worker`: dedicated pg-boss worker and schedules
- `src/notifications`: WhatsApp, push, and email fallback boundary
- `scripts`: migrations, demo seed, and database contract verification
- `infra/caddy`: TLS reverse-proxy configuration

## Data guarantees

- Every application table carries `tenant_id` and forced RLS.
- `attempts`, `attempt_events`, and `lead_events` reject updates and deletes.
- `attempts_current` is derived from append-only events.
- Every lead pins the SLA policy version used for measurement.
- Historical reporting reads immutable daily metric snapshots; only the current day is live.
- Client timestamps are display-only. Server time is the sole source for SLA and reporting calculations.
- Production screens read tenant-scoped PostgreSQL models; browser storage is used only for the temporary offline mutation queue.
- Authenticated pages and APIs are never placed in the service-worker cache, and logout revokes the server session and clears device storage.
