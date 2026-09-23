ALTER TABLE app.lead_followups ADD COLUMN assigned_to uuid;

UPDATE app.lead_followups f
SET assigned_to = COALESCE(
  l.assigned_to,
  (
    SELECT u.id
    FROM app.users u
    WHERE u.tenant_id = f.tenant_id AND u.role = 'owner' AND u.status = 'active'
    ORDER BY u.created_at, u.id
    LIMIT 1
  )
)
FROM app.leads l
WHERE l.tenant_id = f.tenant_id AND l.id = f.lead_id;

ALTER TABLE app.lead_followups ALTER COLUMN assigned_to SET NOT NULL;
ALTER TABLE app.lead_followups
  ADD CONSTRAINT lead_followups_assigned_to_fk
  FOREIGN KEY (tenant_id, assigned_to) REFERENCES app.users(tenant_id, id);
CREATE INDEX lead_followups_assignee_idx
  ON app.lead_followups (tenant_id, assigned_to, due_date, status);

DROP POLICY IF EXISTS lead_followups_visibility ON app.lead_followups;
CREATE POLICY lead_followups_visibility ON app.lead_followups AS RESTRICTIVE FOR SELECT
USING (
  app.current_user_role() IN ('owner', 'agency', 'system')
  OR (app.current_user_role() = 'salesperson' AND assigned_to = app.current_user_id())
);

UPDATE app.leads
SET outcome_reason = CASE
  WHEN stage = 'dead' THEN CASE
    WHEN outcome_reason IN ('not_interested', 'bought_elsewhere', 'price_too_high', 'other') THEN outcome_reason
    ELSE 'other'
  END
  WHEN stage = 'bad' THEN CASE
    WHEN outcome_reason = 'spam' THEN 'spam'
    WHEN outcome_reason IN ('wrong_number', 'invalid_number', 'wrong_person') THEN 'wrong_number'
    WHEN outcome_reason IN ('not_reachable', 'unreachable', 'no_response') THEN 'not_reachable'
    ELSE 'fake_enquiry'
  END
  ELSE NULL
END,
close_reason = NULL,
quality_flag = 'unrated';

ALTER TABLE app.leads DROP CONSTRAINT IF EXISTS leads_outcome_reason_ck;
ALTER TABLE app.leads ADD CONSTRAINT leads_outcome_reason_ck CHECK (
  (stage = 'dead' AND outcome_reason IN ('not_interested', 'bought_elsewhere', 'price_too_high', 'other'))
  OR (stage = 'bad' AND outcome_reason IN ('spam', 'wrong_number', 'not_reachable', 'fake_enquiry'))
  OR (stage NOT IN ('dead', 'bad') AND outcome_reason IS NULL)
);

CREATE OR REPLACE FUNCTION app.derive_attempt_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE lead_row record;
DECLARE followup_count integer;
DECLARE due date;
DECLARE day_index integer;
BEGIN
  SELECT l.*, COALESCE(l.store_id, s.id) AS resolved_store_id
  INTO lead_row
  FROM app.leads l
  LEFT JOIN LATERAL (
    SELECT id FROM app.stores WHERE tenant_id=l.tenant_id AND is_default AND active ORDER BY created_at LIMIT 1
  ) s ON true
  WHERE l.tenant_id=NEW.tenant_id AND l.id=NEW.lead_id
  FOR UPDATE OF l;

  UPDATE app.leads
  SET first_touch_at = LEAST(COALESCE(first_touch_at, NEW.initiated_at), NEW.initiated_at),
      last_attempt_at = GREATEST(COALESCE(last_attempt_at, NEW.initiated_at), NEW.initiated_at),
      attempt_count = attempt_count + 1,
      first_contacted_at = COALESCE(first_contacted_at, NEW.initiated_at),
      first_response_minutes = COALESCE(
        first_response_minutes,
        app.business_minutes_between(NEW.tenant_id, lead_row.resolved_store_id, received_at, NEW.initiated_at)
      ),
      stage = CASE WHEN first_contacted_at IS NULL AND stage='new' THEN 'contacted'::app.lead_stage ELSE stage END,
      updated_at = clock_timestamp()
  WHERE tenant_id=NEW.tenant_id AND id=NEW.lead_id;

  IF lead_row.first_contacted_at IS NULL THEN
    SELECT followup_days INTO followup_count FROM app.tenants WHERE tenant_id=NEW.tenant_id;
    due := (NEW.initiated_at AT TIME ZONE 'Asia/Kolkata')::date;
    FOR day_index IN 1..followup_count LOOP
      due := app.next_store_business_date(NEW.tenant_id, lead_row.resolved_store_id, due);
      INSERT INTO app.lead_followups (tenant_id, lead_id, assigned_to, day_number, due_date)
      VALUES (NEW.tenant_id, NEW.lead_id, lead_row.assigned_to, day_index, due);
    END LOOP;
  END IF;

  IF NEW.client_initiated_at IS NOT NULL
    AND abs(extract(epoch FROM NEW.initiated_at - NEW.client_initiated_at)) > 1800 THEN
    INSERT INTO app.lead_events (tenant_id, lead_id, event_type, actor_id, actor_type, payload, device, ip)
    VALUES (
      NEW.tenant_id, NEW.lead_id, 'late_sync', NEW.user_id, 'user',
      jsonb_build_object('attempt_id',NEW.id,'client_initiated_at',NEW.client_initiated_at,'synced_at',NEW.initiated_at),
      NEW.device, NEW.ip
    );
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.outcome_gate_status(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_outcome text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE attempt_total integer;
DECLARE distinct_days integer;
DECLARE gated boolean;
BEGIN
  SELECT count(*)::integer,
    count(DISTINCT (initiated_at AT TIME ZONE 'Asia/Kolkata')::date)::integer
  INTO attempt_total, distinct_days
  FROM app.attempts WHERE tenant_id=p_tenant_id AND lead_id=p_lead_id;

  gated := (p_outcome='dead' AND p_reason='not_interested')
    OR (p_outcome='bad' AND p_reason IN ('not_reachable','spam'));
  RETURN jsonb_build_object(
    'allowed', NOT gated OR (attempt_total >= 2 AND distinct_days >= 2),
    'attempts', attempt_total,
    'distinct_days', distinct_days,
    'required_attempts', CASE WHEN gated THEN 2 ELSE 0 END,
    'required_days', CASE WHEN gated THEN 2 ELSE 0 END
  );
END $$;

SELECT app.assert_tenant_security();
