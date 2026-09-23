# Go-live checklist

## Required before traffic

- [ ] Approved public domain points to the Mumbai VPS.
- [ ] `.env` uses `NODE_ENV=production`, `DEMO_MODE=false`, the HTTPS `APP_URL`, and unique database passwords.
- [ ] `SESSION_SECRET` is a random value of at least 32 characters.
- [ ] `BOOTSTRAP_OWNER_EMAIL` and `BOOTSTRAP_OWNER_PASSWORD` are set to the real first owner credentials.
- [ ] Google Sheets API is enabled in Google Cloud.
- [ ] Service account email and private key are installed only in the server `.env`.
- [ ] The active Sheet is shared as Viewer with the service account email.
- [ ] Owner has saved and tested the Sheet URL, tab, header row, import cutoff and column mapping.
- [ ] `GOOGLE_SHEETS_ENABLED=true`; `META_CONNECTION_ENABLED=false`.
- [ ] Owner, salesperson and agency email/password sign-in is tested; production contains no demo users.
- [ ] WhatsApp provider is configured, or stakeholders accept that automated WhatsApp messages remain disabled.

## Deploy and verify

```sh
npm ci
NODE_ENV=production npm run launch:check -- --production
docker compose up -d --build
docker compose run --rm migrate npm run db:verify
curl -fsS https://YOUR_APPROVED_DOMAIN/api/health
```

- [ ] Sign in as Salesperson and complete Call, WhatsApp, quick note, follow-up and outcome flows on a test lead.
- [ ] Sign in as Owner and verify Dashboard, Today, Leads, Settings, user management and mobile navigation.
- [ ] Sign in as Agency and confirm the dashboard is read-only.
- [ ] Run **Sync now** in Settings and confirm a new Sheet row appears once in the inbox.
- [ ] Confirm a second sync reports the same row as unchanged rather than adding a duplicate.
- [ ] Confirm web, worker, Postgres, and Caddy containers are healthy and configured to restart.
- [ ] Keep Meta deferred until its separate connection and verification window.
