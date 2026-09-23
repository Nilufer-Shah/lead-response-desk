SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', true);

INSERT INTO app.tenants (tenant_id, client_name, slug, kind, accent_color, timezone, currency)
VALUES ('00000000-0000-0000-0000-000000000001', 'Lead Response Desk system', 'system', 'system', '#7B5EA7', 'Asia/Kolkata', 'INR')
ON CONFLICT DO NOTHING;

SELECT set_config('app.tenant_id', '11111111-1111-4111-8111-111111111111', true);

INSERT INTO app.tenants (tenant_id, client_name, slug, kind, accent_color, timezone, currency)
VALUES ('11111111-1111-4111-8111-111111111111', 'Roopkala Lead Desk', 'roopkala', 'client', '#7B5EA7', 'Asia/Kolkata', 'INR')
ON CONFLICT DO NOTHING;

INSERT INTO app.stores (id, tenant_id, name, slug, city, timezone, is_default)
VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Santacruz', 'santacruz', 'Mumbai', 'Asia/Kolkata', true)
ON CONFLICT DO NOTHING;

INSERT INTO app.business_hours (tenant_id, store_id, weekday, opens_at, closes_at)
SELECT
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  weekday,
  '11:00'::time,
  '20:00'::time
FROM generate_series(0, 6) AS weekday
ON CONFLICT DO NOTHING;

INSERT INTO app.sla_policies (
  id, tenant_id, policy_family_id, version, name, applies_to, clock_mode,
  first_touch_target_minutes, salesperson_reminder_minutes,
  manager_escalation_minutes, owner_escalation_minutes, abandoned_minutes, effective_from
) VALUES
(
  '33333333-3333-4333-8333-333333333331', '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333330', 1, 'Domestic first touch', 'domestic', 'business_hours',
  5, ARRAY[0,3], 15, 60, 240, '2026-01-01T00:00:00+05:30'
),
(
  '33333333-3333-4333-8333-333333333341', '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333340', 1, 'International first touch', 'international', 'continuous',
  5, ARRAY[0,3], NULL, 30, 120, '2026-01-01T00:00:00+05:30'
)
ON CONFLICT DO NOTHING;

INSERT INTO app.source_connections (id, tenant_id, source, name, status, config)
VALUES
  ('44444444-4444-4444-8444-444444444441', '11111111-1111-4111-8111-111111111111', 'meta_lead_form', 'Meta Lead Ads', 'draft', '{"deferred":true}'),
  ('44444444-4444-4444-8444-444444444442', '11111111-1111-4111-8111-111111111111', 'csv_import', 'CSV import', 'healthy', '{}')
ON CONFLICT DO NOTHING;

INSERT INTO app.meta_connections (id, tenant_id, source_connection_id)
VALUES ('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444441')
ON CONFLICT DO NOTHING;

SELECT app.assert_tenant_security();
