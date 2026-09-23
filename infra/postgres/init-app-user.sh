#!/usr/bin/env bash
set -e

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=app_password="$POSTGRES_APP_PASSWORD" <<-'SQL'
  SELECT format('CREATE ROLE lead_desk_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', :'app_password')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_desk_app') \gexec
  SELECT format('ALTER ROLE lead_desk_app PASSWORD %L', :'app_password') \gexec
  CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION lead_desk_app;
  GRANT CONNECT, TEMPORARY ON DATABASE lead_desk TO lead_desk_app;
SQL
