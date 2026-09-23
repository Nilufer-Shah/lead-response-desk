CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.user_role', true), '')
$$;

DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'app'
  LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', item.tablename);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', item.tablename);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON app.%I USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      item.tablename
    );
    IF item.tablename <> 'tenants' THEN
      EXECUTE format(
        'ALTER TABLE app.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES app.tenants(tenant_id)',
        item.tablename,
        item.tablename || '_tenant_fk'
      );
    END IF;
  END LOOP;
END $$;

CREATE POLICY leads_role_select ON app.leads
AS RESTRICTIVE FOR SELECT
USING (
  app.current_user_role() IN ('owner', 'agency', 'admin', 'system')
  OR (
    app.current_user_role() = 'manager'
    AND store_id IN (SELECT store_id FROM app.user_store_memberships WHERE user_id = app.current_user_id())
  )
  OR (
    app.current_user_role() = 'salesperson'
    AND (
      assigned_to = app.current_user_id()
      OR (
        assigned_to IS NULL
        AND store_id IN (SELECT store_id FROM app.user_store_memberships WHERE user_id = app.current_user_id())
      )
    )
  )
);

CREATE POLICY leads_role_insert ON app.leads
AS RESTRICTIVE FOR INSERT
WITH CHECK (
  app.current_user_role() IN ('owner', 'manager', 'admin', 'system')
  OR (app.current_user_role() = 'salesperson' AND assigned_to = app.current_user_id())
);

CREATE POLICY leads_role_update ON app.leads
AS RESTRICTIVE FOR UPDATE
USING (
  app.current_user_role() IN ('owner', 'manager', 'admin', 'system')
  OR (app.current_user_role() = 'salesperson' AND assigned_to = app.current_user_id())
)
WITH CHECK (
  app.current_user_role() IN ('owner', 'manager', 'admin', 'system')
  OR (app.current_user_role() = 'salesperson' AND assigned_to = app.current_user_id())
);

CREATE POLICY leads_no_delete ON app.leads
AS RESTRICTIVE FOR DELETE
USING (false);

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
        app.current_user_role() IN ('owner', 'agency', 'admin', 'system')
        OR (app.current_user_role() = 'manager' AND l.store_id IN (SELECT store_id FROM app.user_store_memberships WHERE user_id = app.current_user_id()))
        OR (app.current_user_role() = 'salesperson' AND (l.assigned_to = app.current_user_id() OR (l.assigned_to IS NULL AND l.store_id IN (SELECT store_id FROM app.user_store_memberships WHERE user_id = app.current_user_id()))))
      )
  )
$$;

CREATE POLICY lead_events_visibility ON app.lead_events AS RESTRICTIVE FOR SELECT
USING (app.can_read_lead(lead_id, tenant_id));
CREATE POLICY attempts_visibility ON app.attempts AS RESTRICTIVE FOR SELECT
USING (app.can_read_lead(lead_id, tenant_id));
CREATE POLICY notes_visibility ON app.notes AS RESTRICTIVE FOR SELECT
USING (app.can_read_lead(lead_id, tenant_id));
CREATE POLICY attempt_events_visibility ON app.attempt_events AS RESTRICTIVE FOR SELECT
USING (EXISTS (SELECT 1 FROM app.attempts a WHERE a.id = attempt_id AND app.can_read_lead(a.lead_id, a.tenant_id)));

CREATE POLICY agency_no_lead_events_write ON app.lead_events AS RESTRICTIVE FOR INSERT
WITH CHECK (app.current_user_role() <> 'agency');
CREATE POLICY agency_no_attempts_write ON app.attempts AS RESTRICTIVE FOR INSERT
WITH CHECK (app.current_user_role() <> 'agency');
CREATE POLICY agency_no_attempt_events_write ON app.attempt_events AS RESTRICTIVE FOR INSERT
WITH CHECK (app.current_user_role() <> 'agency');
CREATE POLICY agency_no_notes_write ON app.notes AS RESTRICTIVE FOR INSERT
WITH CHECK (app.current_user_role() <> 'agency');

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'stores','users','auth_challenges','sessions','business_hours','store_holidays','sla_policies',
    'source_connections','meta_connections','source_forms','form_field_map','meta_ad_cache','leads',
    'lead_sla_cycles','lead_events','attempts','attempt_events','notes','webhook_events',
    'webhook_processing_events','imports','import_rows','assignment_rules','jobs','job_events',
    'notifications','reports','daily_metrics','targets','audit_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE app.%I ADD CONSTRAINT %I UNIQUE (tenant_id, id)', table_name, table_name || '_tenant_id_uq');
  END LOOP;
END $$;

ALTER TABLE app.users ADD CONSTRAINT users_store_fk FOREIGN KEY (tenant_id, store_id) REFERENCES app.stores(tenant_id, id);
ALTER TABLE app.user_store_memberships ADD CONSTRAINT memberships_user_fk FOREIGN KEY (tenant_id, user_id) REFERENCES app.users(tenant_id, id);
ALTER TABLE app.user_store_memberships ADD CONSTRAINT memberships_store_fk FOREIGN KEY (tenant_id, store_id) REFERENCES app.stores(tenant_id, id);
ALTER TABLE app.auth_challenges ADD CONSTRAINT auth_user_fk FOREIGN KEY (tenant_id, user_id) REFERENCES app.users(tenant_id, id);
ALTER TABLE app.sessions ADD CONSTRAINT sessions_user_fk FOREIGN KEY (tenant_id, user_id) REFERENCES app.users(tenant_id, id);
ALTER TABLE app.business_hours ADD CONSTRAINT hours_store_fk FOREIGN KEY (tenant_id, store_id) REFERENCES app.stores(tenant_id, id);
ALTER TABLE app.store_holidays ADD CONSTRAINT holidays_store_fk FOREIGN KEY (tenant_id, store_id) REFERENCES app.stores(tenant_id, id);
ALTER TABLE app.meta_connections ADD CONSTRAINT meta_source_connection_fk FOREIGN KEY (tenant_id, source_connection_id) REFERENCES app.source_connections(tenant_id, id);
ALTER TABLE app.source_forms ADD CONSTRAINT forms_source_connection_fk FOREIGN KEY (tenant_id, source_connection_id) REFERENCES app.source_connections(tenant_id, id);
ALTER TABLE app.form_field_map ADD CONSTRAINT field_map_form_fk FOREIGN KEY (tenant_id, source_form_id) REFERENCES app.source_forms(tenant_id, id);
ALTER TABLE app.leads ADD CONSTRAINT leads_store_fk FOREIGN KEY (tenant_id, store_id) REFERENCES app.stores(tenant_id, id);
ALTER TABLE app.leads ADD CONSTRAINT leads_assignee_fk FOREIGN KEY (tenant_id, assigned_to) REFERENCES app.users(tenant_id, id);
ALTER TABLE app.leads ADD CONSTRAINT leads_sla_policy_fk FOREIGN KEY (tenant_id, sla_policy_version_id) REFERENCES app.sla_policies(tenant_id, id);
ALTER TABLE app.lead_sla_cycles ADD CONSTRAINT sla_cycles_lead_fk FOREIGN KEY (tenant_id, lead_id) REFERENCES app.leads(tenant_id, id);
ALTER TABLE app.lead_sla_cycles ADD CONSTRAINT sla_cycles_policy_fk FOREIGN KEY (tenant_id, sla_policy_version_id) REFERENCES app.sla_policies(tenant_id, id);
ALTER TABLE app.lead_events ADD CONSTRAINT lead_events_lead_fk FOREIGN KEY (tenant_id, lead_id) REFERENCES app.leads(tenant_id, id);
ALTER TABLE app.attempts ADD CONSTRAINT attempts_lead_fk FOREIGN KEY (tenant_id, lead_id) REFERENCES app.leads(tenant_id, id);
ALTER TABLE app.attempts ADD CONSTRAINT attempts_user_fk FOREIGN KEY (tenant_id, user_id) REFERENCES app.users(tenant_id, id);
ALTER TABLE app.attempt_events ADD CONSTRAINT attempt_events_attempt_fk FOREIGN KEY (tenant_id, attempt_id) REFERENCES app.attempts(tenant_id, id);
ALTER TABLE app.notes ADD CONSTRAINT notes_lead_fk FOREIGN KEY (tenant_id, lead_id) REFERENCES app.leads(tenant_id, id);
ALTER TABLE app.notes ADD CONSTRAINT notes_user_fk FOREIGN KEY (tenant_id, user_id) REFERENCES app.users(tenant_id, id);
ALTER TABLE app.webhook_processing_events ADD CONSTRAINT webhook_processing_event_fk FOREIGN KEY (tenant_id, webhook_event_id) REFERENCES app.webhook_events(tenant_id, id);
ALTER TABLE app.import_rows ADD CONSTRAINT import_rows_import_fk FOREIGN KEY (tenant_id, import_id) REFERENCES app.imports(tenant_id, id);
ALTER TABLE app.job_events ADD CONSTRAINT job_events_job_fk FOREIGN KEY (tenant_id, job_id) REFERENCES app.jobs(tenant_id, id);
ALTER TABLE app.notifications ADD CONSTRAINT notifications_lead_fk FOREIGN KEY (tenant_id, lead_id) REFERENCES app.leads(tenant_id, id);
ALTER TABLE app.notifications ADD CONSTRAINT notifications_user_fk FOREIGN KEY (tenant_id, recipient_user_id) REFERENCES app.users(tenant_id, id);
ALTER TABLE app.targets ADD CONSTRAINT targets_user_fk FOREIGN KEY (tenant_id, user_id) REFERENCES app.users(tenant_id, id);

CREATE OR REPLACE FUNCTION app.block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is forbidden', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'lead_events', 'attempts', 'attempt_events', 'notes', 'audit_log',
    'sla_policies', 'daily_metrics', 'webhook_processing_events', 'job_events'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.block_mutation()',
      table_name || '_append_only',
      table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION app.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tenants', 'stores', 'users', 'auth_challenges', 'sessions', 'business_hours',
    'store_holidays', 'source_connections', 'meta_connections', 'source_forms',
    'form_field_map', 'meta_ad_cache', 'leads', 'lead_sla_cycles', 'webhook_events',
    'imports', 'import_rows', 'assignment_rules', 'jobs', 'notifications', 'reports',
    'targets', 'user_store_memberships'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()',
      table_name || '_updated_at',
      table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION app.derive_attempt_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE delta_seconds numeric;
BEGIN
  UPDATE app.leads
  SET first_touch_at = LEAST(COALESCE(first_touch_at, NEW.initiated_at), NEW.initiated_at),
      last_attempt_at = GREATEST(COALESCE(last_attempt_at, NEW.initiated_at), NEW.initiated_at),
      attempt_count = attempt_count + 1,
      updated_at = clock_timestamp()
  WHERE tenant_id = NEW.tenant_id AND id = NEW.lead_id;

  IF NEW.client_initiated_at IS NOT NULL THEN
    delta_seconds := abs(extract(epoch FROM NEW.initiated_at - NEW.client_initiated_at));
    IF delta_seconds > 1800 THEN
      INSERT INTO app.lead_events (
        tenant_id, lead_id, event_type, actor_id, actor_type, payload, device, ip
      ) VALUES (
        NEW.tenant_id, NEW.lead_id, 'late_sync', NEW.user_id, 'user',
        jsonb_build_object(
          'attempt_id', NEW.id,
          'client_initiated_at', NEW.client_initiated_at,
          'synced_at', NEW.initiated_at,
          'delta_seconds', delta_seconds
        ),
        NEW.device, NEW.ip
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER attempts_derive_lead
AFTER INSERT ON app.attempts
FOR EACH ROW EXECUTE FUNCTION app.derive_attempt_fields();

CREATE OR REPLACE FUNCTION app.record_late_note_sync()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE delta_seconds numeric;
BEGIN
  IF NEW.client_initiated_at IS NOT NULL THEN
    delta_seconds := abs(extract(epoch FROM NEW.created_at - NEW.client_initiated_at));
    IF delta_seconds > 1800 THEN
      INSERT INTO app.lead_events (
        tenant_id, lead_id, event_type, actor_id, actor_type, payload, device, ip
      ) VALUES (
        NEW.tenant_id, NEW.lead_id, 'late_sync', NEW.user_id, 'user',
        jsonb_build_object(
          'note_id', NEW.id,
          'client_initiated_at', NEW.client_initiated_at,
          'synced_at', NEW.created_at,
          'delta_seconds', delta_seconds
        ),
        NEW.device, NEW.ip
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER notes_record_late_sync
AFTER INSERT ON app.notes
FOR EACH ROW EXECUTE FUNCTION app.record_late_note_sync();

CREATE OR REPLACE VIEW app.attempts_current
WITH (security_invoker = true)
AS
SELECT
  a.id,
  a.tenant_id,
  a.lead_id,
  a.user_id,
  a.channel,
  a.initiated_at,
  a.client_initiated_at,
  disposition.payload ->> 'disposition' AS disposition,
  disposition.occurred_at AS disposition_at,
  receipt.event_type::text AS whatsapp_receipt_state,
  receipt.occurred_at AS whatsapp_receipt_at,
  duration.payload ->> 'duration_sec' AS duration_sec,
  CASE
    WHEN disposition.occurred_at <= a.initiated_at + interval '5 minutes' THEN true
    WHEN receipt.event_type IN ('whatsapp_delivered', 'whatsapp_read') THEN true
    ELSE false
  END AS verified
FROM app.attempts a
LEFT JOIN LATERAL (
  SELECT ae.payload, ae.occurred_at
  FROM app.attempt_events ae
  WHERE ae.tenant_id = a.tenant_id
    AND ae.attempt_id = a.id
    AND ae.event_type = 'disposition_logged'
  ORDER BY ae.occurred_at DESC, ae.id DESC
  LIMIT 1
) disposition ON true
LEFT JOIN LATERAL (
  SELECT ae.event_type, ae.occurred_at
  FROM app.attempt_events ae
  WHERE ae.tenant_id = a.tenant_id
    AND ae.attempt_id = a.id
    AND ae.event_type IN ('whatsapp_delivered', 'whatsapp_read')
  ORDER BY ae.occurred_at DESC, ae.id DESC
  LIMIT 1
) receipt ON true
LEFT JOIN LATERAL (
  SELECT ae.payload
  FROM app.attempt_events ae
  WHERE ae.tenant_id = a.tenant_id
    AND ae.attempt_id = a.id
    AND ae.event_type = 'duration_reported'
  ORDER BY ae.occurred_at DESC, ae.id DESC
  LIMIT 1
) duration ON true;

CREATE OR REPLACE FUNCTION app.close_gate_status(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_close_reason app.close_reason DEFAULT NULL,
  p_quality_flag app.quality_flag DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_linked_lead_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  attempt_total integer;
  distinct_days integer;
  whatsapp_sends integer;
  invalid_evidence integer;
  missing jsonb := '[]'::jsonb;
  requires_full boolean;
BEGIN
  SELECT
    count(*)::integer,
    count(DISTINCT (initiated_at AT TIME ZONE 'Asia/Kolkata')::date)::integer,
    count(*) FILTER (WHERE channel = 'whatsapp')::integer
  INTO attempt_total, distinct_days, whatsapp_sends
  FROM app.attempts
  WHERE tenant_id = p_tenant_id AND lead_id = p_lead_id;

  SELECT count(*)::integer INTO invalid_evidence
  FROM app.attempts a
  LEFT JOIN app.attempt_events ae
    ON ae.tenant_id = a.tenant_id AND ae.attempt_id = a.id
  WHERE a.tenant_id = p_tenant_id AND a.lead_id = p_lead_id
    AND (
      (ae.event_type = 'disposition_logged' AND ae.payload ->> 'disposition' = 'invalid_number')
      OR (ae.event_type = 'whatsapp_failed' AND ae.payload ->> 'reason' = 'not_on_whatsapp')
    );

  requires_full := p_close_reason IN ('unreachable', 'no_response')
    OR p_quality_flag IN ('spam', 'wrong_person', 'budget_mismatch', 'competitor');

  IF requires_full THEN
    IF attempt_total < 3 THEN missing := missing || jsonb_build_array(jsonb_build_object('key','attempts','remaining',3-attempt_total)); END IF;
    IF distinct_days < 2 THEN missing := missing || jsonb_build_array(jsonb_build_object('key','days','remaining',2-distinct_days)); END IF;
    IF whatsapp_sends < 1 THEN missing := missing || jsonb_build_array(jsonb_build_object('key','whatsapp','remaining',1)); END IF;
    IF length(trim(COALESCE(p_note, ''))) < 15 THEN missing := missing || jsonb_build_array(jsonb_build_object('key','note','remaining',15-length(trim(COALESCE(p_note,''))))); END IF;
  ELSIF p_quality_flag = 'out_of_area' OR p_close_reason = 'out_of_area' THEN
    IF attempt_total < 1 THEN missing := missing || jsonb_build_array(jsonb_build_object('key','attempts','remaining',1)); END IF;
    IF length(trim(COALESCE(p_note, ''))) < 1 THEN missing := missing || jsonb_build_array(jsonb_build_object('key','note','remaining',1)); END IF;
  ELSIF p_quality_flag = 'invalid_number' OR p_close_reason = 'invalid_number' THEN
    IF attempt_total < 1 THEN missing := missing || jsonb_build_array(jsonb_build_object('key','attempts','remaining',1)); END IF;
    IF invalid_evidence < 1 THEN missing := missing || jsonb_build_array(jsonb_build_object('key','evidence','remaining',1)); END IF;
  ELSIF p_close_reason = 'duplicate' AND p_linked_lead_id IS NULL THEN
    missing := missing || jsonb_build_array(jsonb_build_object('key','linked_lead','remaining',1));
  END IF;

  RETURN jsonb_build_object(
    'allowed', jsonb_array_length(missing) = 0,
    'missing', missing,
    'attempts', attempt_total,
    'distinct_days', distinct_days,
    'whatsapp_attempts', whatsapp_sends
  );
END $$;

CREATE OR REPLACE FUNCTION app.assert_tenant_security()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE issue_count integer;
BEGIN
  SELECT count(*) INTO issue_count
  FROM pg_class t
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'app'
    AND t.relkind IN ('r', 'p')
    AND (
      NOT t.relrowsecurity
      OR NOT t.relforcerowsecurity
      OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = n.nspname AND c.table_name = t.relname AND c.column_name = 'tenant_id' AND c.is_nullable = 'NO'
      )
      OR NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = n.nspname AND p.tablename = t.relname
      )
    );
  IF issue_count > 0 THEN
    RAISE EXCEPTION '% app tables are missing tenant_id or complete RLS', issue_count;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_desk_app') THEN
    GRANT USAGE ON SCHEMA app TO lead_desk_app;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA app TO lead_desk_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO lead_desk_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO lead_desk_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE ON TABLES TO lead_desk_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO lead_desk_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT EXECUTE ON FUNCTIONS TO lead_desk_app;
  END IF;
END $$;
