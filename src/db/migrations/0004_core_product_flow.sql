-- Block 1 product flow. Existing migrations remain immutable.

ALTER TYPE app.user_role RENAME TO user_role_legacy;
CREATE TYPE app.user_role AS ENUM ('owner', 'salesperson', 'agency');
ALTER TABLE app.users ALTER COLUMN role TYPE app.user_role
USING (
  CASE role::text
    WHEN 'admin' THEN 'owner'
    WHEN 'manager' THEN 'salesperson'
    ELSE role::text
  END
)::app.user_role;
DROP TYPE app.user_role_legacy;

ALTER TABLE app.leads DROP CONSTRAINT IF EXISTS leads_won_value_ck;
ALTER TABLE app.leads ALTER COLUMN stage DROP DEFAULT;
ALTER TYPE app.lead_stage RENAME TO lead_stage_legacy;
CREATE TYPE app.lead_stage AS ENUM ('new', 'contacted', 'follow_up', 'dormant', 'won', 'dead', 'bad');
ALTER TABLE app.leads ALTER COLUMN stage TYPE app.lead_stage
USING (
  CASE stage::text
    WHEN 'new' THEN 'new'
    WHEN 'contacted' THEN 'contacted'
    WHEN 'won' THEN 'won'
    WHEN 'lost' THEN 'dead'
    ELSE 'follow_up'
  END
)::app.lead_stage;
ALTER TABLE app.leads ALTER COLUMN stage SET DEFAULT 'new'::app.lead_stage;
DROP TYPE app.lead_stage_legacy;

CREATE TYPE app.followup_status AS ENUM ('pending', 'done', 'missed', 'cancelled');
CREATE TYPE app.followup_answer AS ENUM ('yes', 'no');

ALTER TABLE app.tenants ADD COLUMN followup_days integer NOT NULL DEFAULT 4;
ALTER TABLE app.tenants ADD CONSTRAINT tenants_followup_days_ck CHECK (followup_days BETWEEN 1 AND 14);

ALTER TABLE app.users ADD COLUMN password_hash text;
ALTER TABLE app.users ADD COLUMN password_reset_required boolean NOT NULL DEFAULT false;

ALTER TABLE app.leads ADD COLUMN meta_lead_id text;
ALTER TABLE app.leads ADD COLUMN first_contacted_at timestamptz;
ALTER TABLE app.leads ADD COLUMN first_response_minutes integer;
ALTER TABLE app.leads ADD COLUMN closed_by uuid;
ALTER TABLE app.leads ADD COLUMN outcome_reason text;
UPDATE app.leads SET first_contacted_at = first_touch_at
WHERE first_contacted_at IS NULL AND first_touch_at IS NOT NULL;
UPDATE app.leads SET outcome_reason=COALESCE(close_reason::text,'other')
WHERE stage='dead' AND outcome_reason IS NULL;
CREATE UNIQUE INDEX leads_meta_lead_id_uq ON app.leads (tenant_id, meta_lead_id) WHERE meta_lead_id IS NOT NULL;
ALTER TABLE app.leads ADD CONSTRAINT leads_closed_by_fk FOREIGN KEY (tenant_id, closed_by) REFERENCES app.users(tenant_id, id);
ALTER TABLE app.leads ADD CONSTRAINT leads_won_value_ck CHECK (stage <> 'won' OR order_value > 0);
ALTER TABLE app.leads ADD CONSTRAINT leads_outcome_reason_ck CHECK (
  (stage NOT IN ('dead', 'bad')) OR outcome_reason IS NOT NULL
);

ALTER TABLE app.google_sheet_connections ADD COLUMN import_after timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE app.google_sheet_connections ADD COLUMN last_synced_row integer NOT NULL DEFAULT 0;
ALTER TABLE app.google_sheet_connections ADD COLUMN last_full_check_at timestamptz;
ALTER TABLE app.google_sheet_connections ADD COLUMN last_skipped_rows integer NOT NULL DEFAULT 0;
ALTER TABLE app.google_sheet_sync_runs ADD COLUMN skipped_rows integer NOT NULL DEFAULT 0;
ALTER TABLE app.google_sheet_sync_runs ADD COLUMN unchanged_rows integer NOT NULL DEFAULT 0;

CREATE TABLE app.lead_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  day_number integer NOT NULL,
  due_date date NOT NULL,
  status app.followup_status NOT NULL DEFAULT 'pending',
  answer app.followup_answer,
  note text,
  attempt_id uuid,
  answered_at timestamptz,
  answered_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT lead_followups_tenant_fk FOREIGN KEY (tenant_id) REFERENCES app.tenants(tenant_id),
  CONSTRAINT lead_followups_lead_fk FOREIGN KEY (tenant_id, lead_id) REFERENCES app.leads(tenant_id, id),
  CONSTRAINT lead_followups_attempt_fk FOREIGN KEY (tenant_id, attempt_id) REFERENCES app.attempts(tenant_id, id),
  CONSTRAINT lead_followups_answered_by_fk FOREIGN KEY (tenant_id, answered_by) REFERENCES app.users(tenant_id, id),
  CONSTRAINT lead_followups_day_ck CHECK (day_number BETWEEN 1 AND 14),
  CONSTRAINT lead_followups_answer_ck CHECK (
    (status = 'done' AND answer IS NOT NULL AND note IS NOT NULL AND length(trim(note)) >= 10 AND answered_at IS NOT NULL AND answered_by IS NOT NULL)
    OR (status <> 'done' AND answer IS NULL)
  ),
  CONSTRAINT lead_followups_tenant_id_uq UNIQUE (tenant_id, id)
);
CREATE INDEX lead_followups_due_idx ON app.lead_followups (tenant_id, status, due_date);
ALTER TABLE app.lead_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.lead_followups FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.lead_followups
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY lead_followups_visibility ON app.lead_followups AS RESTRICTIVE FOR SELECT
  USING (app.can_read_lead(lead_id, tenant_id));
CREATE POLICY agency_no_followups_insert ON app.lead_followups AS RESTRICTIVE FOR INSERT
  WITH CHECK (app.current_user_role() <> 'agency' AND app.can_read_lead(lead_id, tenant_id));
CREATE POLICY agency_no_followups_update ON app.lead_followups AS RESTRICTIVE FOR UPDATE
  USING (app.current_user_role() <> 'agency' AND app.can_read_lead(lead_id, tenant_id))
  WITH CHECK (app.current_user_role() <> 'agency' AND app.can_read_lead(lead_id, tenant_id));
CREATE POLICY lead_followups_no_delete ON app.lead_followups AS RESTRICTIVE FOR DELETE USING (false);
CREATE TRIGGER lead_followups_updated_at BEFORE UPDATE ON app.lead_followups
FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

DROP POLICY IF EXISTS leads_role_select ON app.leads;
DROP POLICY IF EXISTS leads_role_insert ON app.leads;
DROP POLICY IF EXISTS leads_role_update ON app.leads;
CREATE POLICY leads_role_select ON app.leads AS RESTRICTIVE FOR SELECT
USING (
  app.current_user_role() IN ('owner', 'agency', 'system')
  OR (app.current_user_role() = 'salesperson' AND assigned_to = app.current_user_id())
);
CREATE POLICY leads_role_insert ON app.leads AS RESTRICTIVE FOR INSERT
WITH CHECK (
  app.current_user_role() IN ('owner', 'system')
  OR (app.current_user_role() = 'salesperson' AND assigned_to = app.current_user_id())
);
CREATE POLICY leads_role_update ON app.leads AS RESTRICTIVE FOR UPDATE
USING (
  app.current_user_role() IN ('owner', 'system')
  OR (app.current_user_role() = 'salesperson' AND assigned_to = app.current_user_id())
)
WITH CHECK (
  app.current_user_role() IN ('owner', 'system')
  OR (app.current_user_role() = 'salesperson' AND assigned_to = app.current_user_id())
);

CREATE OR REPLACE FUNCTION app.can_read_lead(p_lead_id uuid, p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.leads l
    WHERE l.id = p_lead_id AND l.tenant_id = p_tenant_id
      AND (
        app.current_user_role() IN ('owner', 'agency', 'system')
        OR (app.current_user_role() = 'salesperson' AND l.assigned_to = app.current_user_id())
      )
  )
$$;

CREATE OR REPLACE FUNCTION app.is_store_business_date(p_tenant_id uuid, p_store_id uuid, p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app.business_hours bh
    LEFT JOIN app.store_holidays sh
      ON sh.tenant_id = bh.tenant_id AND sh.store_id = bh.store_id AND sh.holiday_date = p_date
    WHERE bh.tenant_id = p_tenant_id
      AND bh.store_id = p_store_id
      AND bh.weekday = extract(dow FROM p_date)::integer
      AND bh.enabled
      AND NOT COALESCE(sh.closed, false)
  )
$$;

CREATE OR REPLACE FUNCTION app.next_store_business_date(p_tenant_id uuid, p_store_id uuid, p_after date)
RETURNS date
LANGUAGE plpgsql
STABLE
AS $$
DECLARE candidate date := p_after + 1;
DECLARE guard integer := 0;
BEGIN
  WHILE NOT app.is_store_business_date(p_tenant_id, p_store_id, candidate) LOOP
    candidate := candidate + 1;
    guard := guard + 1;
    IF guard > 370 THEN RAISE EXCEPTION 'No open business day found'; END IF;
  END LOOP;
  RETURN candidate;
END $$;

CREATE OR REPLACE FUNCTION app.business_minutes_between(
  p_tenant_id uuid,
  p_store_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz
)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT CASE WHEN p_ended_at <= p_started_at THEN 0 ELSE count(*)::integer END
  FROM generate_series(p_started_at, p_ended_at - interval '1 microsecond', interval '1 minute') AS tick
  JOIN app.business_hours bh
    ON bh.tenant_id = p_tenant_id
   AND bh.store_id = p_store_id
   AND bh.weekday = extract(dow FROM (tick AT TIME ZONE 'Asia/Kolkata'))::integer
   AND bh.enabled
  LEFT JOIN app.store_holidays sh
    ON sh.tenant_id = p_tenant_id
   AND sh.store_id = p_store_id
   AND sh.holiday_date = (tick AT TIME ZONE 'Asia/Kolkata')::date
  WHERE NOT COALESCE(sh.closed, false)
    AND (tick AT TIME ZONE 'Asia/Kolkata')::time >= COALESCE(sh.opens_at, bh.opens_at)
    AND (tick AT TIME ZONE 'Asia/Kolkata')::time < COALESCE(sh.closes_at, bh.closes_at)
$$;

CREATE OR REPLACE FUNCTION app.add_store_business_minutes(
  p_tenant_id uuid,
  p_store_id uuid,
  p_started_at timestamptz,
  p_minutes integer
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $$
DECLARE cursor_at timestamptz := date_trunc('minute', p_started_at);
DECLARE remaining integer := p_minutes;
DECLARE guard integer := 0;
DECLARE is_open boolean;
BEGIN
  IF p_minutes < 0 THEN RAISE EXCEPTION 'Business minutes cannot be negative'; END IF;
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM app.business_hours bh
      LEFT JOIN app.store_holidays sh
        ON sh.tenant_id=bh.tenant_id AND sh.store_id=bh.store_id
       AND sh.holiday_date=(cursor_at AT TIME ZONE 'Asia/Kolkata')::date
      WHERE bh.tenant_id=p_tenant_id AND bh.store_id=p_store_id AND bh.enabled
        AND bh.weekday=extract(dow FROM (cursor_at AT TIME ZONE 'Asia/Kolkata'))::integer
        AND NOT COALESCE(sh.closed,false)
        AND (cursor_at AT TIME ZONE 'Asia/Kolkata')::time >= COALESCE(sh.opens_at,bh.opens_at)
        AND (cursor_at AT TIME ZONE 'Asia/Kolkata')::time < COALESCE(sh.closes_at,bh.closes_at)
    ) INTO is_open;
    IF is_open THEN
      IF remaining = 0 THEN RETURN cursor_at; END IF;
      remaining := remaining - 1;
    END IF;
    cursor_at := cursor_at + interval '1 minute';
    guard := guard + 1;
    IF guard > 60 * 24 * 370 THEN RAISE EXCEPTION 'No store hours found within one year'; END IF;
  END LOOP;
END $$;

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
      first_response_minutes = COALESCE(first_response_minutes,
        CASE WHEN lead_row.is_international
          THEN GREATEST(0,floor(extract(epoch FROM (NEW.initiated_at-received_at))/60)::integer)
          ELSE app.business_minutes_between(NEW.tenant_id, lead_row.resolved_store_id, received_at, NEW.initiated_at)
        END),
      stage = CASE WHEN first_contacted_at IS NULL AND stage='new' THEN 'contacted'::app.lead_stage ELSE stage END,
      updated_at = clock_timestamp()
  WHERE tenant_id=NEW.tenant_id AND id=NEW.lead_id;

  IF lead_row.first_contacted_at IS NULL THEN
    SELECT followup_days INTO followup_count FROM app.tenants WHERE tenant_id=NEW.tenant_id;
    due := (NEW.initiated_at AT TIME ZONE 'Asia/Kolkata')::date;
    FOR day_index IN 1..followup_count LOOP
      due := app.next_store_business_date(NEW.tenant_id, lead_row.resolved_store_id, due);
      INSERT INTO app.lead_followups (tenant_id, lead_id, day_number, due_date)
      VALUES (NEW.tenant_id, NEW.lead_id, day_index, due);
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

CREATE OR REPLACE FUNCTION app.record_lead_stage_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.stage IS DISTINCT FROM NEW.stage THEN
    INSERT INTO app.lead_events (tenant_id, lead_id, event_type, actor_id, actor_type, payload)
    VALUES (
      NEW.tenant_id, NEW.id, 'stage_changed', app.current_user_id(),
      CASE WHEN app.current_user_id() IS NULL THEN 'system'::app.actor_type ELSE 'user'::app.actor_type END,
      jsonb_build_object('fromStage',OLD.stage::text,'toStage',NEW.stage::text)
    );
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS leads_record_stage_change ON app.leads;
CREATE TRIGGER leads_record_stage_change AFTER UPDATE OF stage ON app.leads
FOR EACH ROW EXECUTE FUNCTION app.record_lead_stage_change();

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

UPDATE app.business_hours bh
SET opens_at='10:30'::time, closes_at='20:30'::time, enabled=true
FROM app.stores s
WHERE s.tenant_id=bh.tenant_id AND s.id=bh.store_id AND s.is_default;

SELECT app.assert_tenant_security();
