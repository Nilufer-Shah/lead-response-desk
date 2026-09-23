CREATE TABLE app.google_sheet_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  source_connection_id uuid NOT NULL,
  spreadsheet_id text NOT NULL,
  sheet_name text NOT NULL,
  header_row integer NOT NULL DEFAULT 1 CHECK (header_row BETWEEN 1 AND 100),
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  last_synced_at timestamptz,
  last_healthy_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_sheet_connection_source_uq UNIQUE (tenant_id, source_connection_id),
  CONSTRAINT google_sheet_connection_sheet_uq UNIQUE (tenant_id, spreadsheet_id, sheet_name),
  CONSTRAINT google_sheet_connections_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT google_sheet_connections_tenant_fk FOREIGN KEY (tenant_id) REFERENCES app.tenants(tenant_id),
  CONSTRAINT google_sheet_source_connection_fk FOREIGN KEY (tenant_id, source_connection_id) REFERENCES app.source_connections(tenant_id, id),
  CONSTRAINT google_sheet_created_by_fk FOREIGN KEY (tenant_id, created_by) REFERENCES app.users(tenant_id, id)
);

CREATE INDEX google_sheet_connections_enabled_idx ON app.google_sheet_connections (tenant_id, enabled);

CREATE TABLE app.google_sheet_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  google_sheet_connection_id uuid NOT NULL,
  status text NOT NULL,
  rows_seen integer NOT NULL DEFAULT 0,
  inserted_rows integer NOT NULL DEFAULT 0,
  repeat_rows integer NOT NULL DEFAULT 0,
  rejected_rows integer NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_sheet_sync_runs_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT google_sheet_sync_runs_tenant_fk FOREIGN KEY (tenant_id) REFERENCES app.tenants(tenant_id),
  CONSTRAINT google_sheet_sync_connection_fk FOREIGN KEY (tenant_id, google_sheet_connection_id) REFERENCES app.google_sheet_connections(tenant_id, id)
);

CREATE INDEX google_sheet_sync_runs_lookup_idx ON app.google_sheet_sync_runs (tenant_id, google_sheet_connection_id, started_at DESC);

ALTER TABLE app.google_sheet_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.google_sheet_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.google_sheet_connections
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE app.google_sheet_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.google_sheet_sync_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.google_sheet_sync_runs
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());

CREATE TRIGGER google_sheet_connections_updated_at BEFORE UPDATE ON app.google_sheet_connections
FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER google_sheet_sync_runs_updated_at BEFORE UPDATE ON app.google_sheet_sync_runs
FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_desk_app') THEN
    GRANT SELECT, INSERT, UPDATE ON app.google_sheet_connections, app.google_sheet_sync_runs TO lead_desk_app;
  END IF;
END $$;

SELECT app.assert_tenant_security();
