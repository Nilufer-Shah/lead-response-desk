-- Block 2: direct Meta Lead Ads connection state. Credentials remain environment-only.

ALTER TABLE app.meta_connections
  ADD COLUMN last_reconciled_at timestamptz,
  ADD COLUMN last_reconciliation_result jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE app.meta_connections SET token_ciphertext=NULL;

CREATE UNIQUE INDEX meta_connection_source_uq ON app.meta_connections (tenant_id, source_connection_id);

ALTER TABLE app.meta_connections
  ADD CONSTRAINT meta_token_not_stored_ck CHECK (token_ciphertext IS NULL);

UPDATE app.source_connections SET config=config-'deferred',updated_at=clock_timestamp()
WHERE source='meta_lead_form';

SELECT app.assert_tenant_security();
