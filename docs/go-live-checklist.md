# Go-live checklist

## Required before traffic

- [ ] Approved domain points to the VPS; the domain purchase or DNS change was explicitly approved.
- [ ] `.env` uses `NODE_ENV=production`, the HTTPS `APP_URL`, `APP_DOMAIN`, unique database passwords and a random 32+ character `SESSION_SECRET`.
- [ ] Real `BOOTSTRAP_OWNER_EMAIL`, `BOOTSTRAP_OWNER_NAME` and `BOOTSTRAP_OWNER_PASSWORD` are set.
- [ ] Google Sheets API is enabled; its service-account email/private key exist only in server `.env`.
- [ ] The active Sheet is shared as Viewer and Owner has tested URL, tab, header, cutoff and mappings.
- [ ] `GOOGLE_SHEETS_ENABLED=true`; keep `META_CONNECTION_ENABLED=false` until its separate checklist is complete.
- [ ] Owner, salesperson and agency email/password access is tested.

## Deploy and verify

```sh
NODE_ENV=production npm run launch:check -- --production
docker compose up -d --build
docker compose ps
docker compose run --rm migrate npm run db:verify
curl -fsS https://YOUR_APPROVED_DOMAIN/api/health
```

- [ ] PostgreSQL, web, worker and Caddy are healthy and restart automatically.
- [ ] Owner creates two salespeople; a new Sheet row alternates assignment.
- [ ] Historic Sheet rows before the cutoff are skipped.
- [ ] Salesperson tests Call, WhatsApp, quick note, follow-up and outcome flows on a phone.
- [ ] “Yes” without a same-day contact tap is blocked.
- [ ] Gated Dead/Bad outcomes are blocked until two attempts on two days.
- [ ] Won cancels pending follow-ups.
- [ ] Dormant repeat enquiry reactivates the lead.
- [ ] Salesperson cannot see another salesperson’s leads; Agency cannot modify data.
- [ ] Today, 7-day and 30-day dashboard values match the controlled test dataset.
- [ ] `owner:reset-password` is tested, then its one-time environment value is removed.

## Meta activation (later)

- [ ] App belongs to the client’s Business Manager.
- [ ] System-user token has `leads_retrieval`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `ads_read`.
- [ ] Page Leads Access is granted and Page is subscribed to `leadgen`.
- [ ] HTTPS callback and verify token succeed.
- [ ] Form IDs/mappings are saved and **Test connection** passes.
- [ ] Lead Ads Testing Tool creates exactly one lead.
- [ ] `META_CONNECTION_ENABLED=true`; web and worker restarted; health remains OK.
