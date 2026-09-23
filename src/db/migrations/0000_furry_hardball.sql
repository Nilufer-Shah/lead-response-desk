CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TYPE "app"."actor_type" AS ENUM('system', 'user', 'client', 'agency');--> statement-breakpoint
CREATE TYPE "app"."attempt_channel" AS ENUM('call', 'whatsapp', 'sms', 'email', 'in_person');--> statement-breakpoint
CREATE TYPE "app"."attempt_event_type" AS ENUM('disposition_logged', 'whatsapp_queued', 'whatsapp_sent', 'whatsapp_delivered', 'whatsapp_read', 'whatsapp_replied', 'whatsapp_failed', 'duration_reported', 'note_added');--> statement-breakpoint
CREATE TYPE "app"."close_reason" AS ENUM('bought', 'bought_elsewhere', 'price_too_high', 'out_of_area', 'just_browsing', 'unreachable', 'wrong_number', 'invalid_number', 'duplicate', 'spam', 'no_response');--> statement-breakpoint
CREATE TYPE "app"."connection_status" AS ENUM('draft', 'healthy', 'degraded', 'disabled');--> statement-breakpoint
CREATE TYPE "app"."conversation_state" AS ENUM('waiting_on_us', 'waiting_on_lead', 'scheduled', 'closed');--> statement-breakpoint
CREATE TYPE "app"."import_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "app"."job_status" AS ENUM('scheduled', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "app"."lead_source" AS ENUM('meta_lead_form', 'csv_import', 'whatsapp', 'instagram_dm', 'instagram_comment', 'instagram_story_reply', 'website_form', 'website_whatsapp', 'walk_in', 'phone_inbound', 'referral', 'other');--> statement-breakpoint
CREATE TYPE "app"."lead_stage" AS ENUM('new', 'contacted', 'qualified', 'visit_booked', 'visited', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "app"."metric_dimension" AS ENUM('tenant', 'salesperson', 'campaign');--> statement-breakpoint
CREATE TYPE "app"."notification_channel" AS ENUM('whatsapp', 'push', 'email');--> statement-breakpoint
CREATE TYPE "app"."notification_status" AS ENUM('queued', 'sent', 'delivered', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "app"."quality_flag" AS ENUM('unrated', 'good', 'invalid_number', 'wrong_person', 'out_of_area', 'budget_mismatch', 'competitor', 'spam', 'duplicate');--> statement-breakpoint
CREATE TYPE "app"."import_row_status" AS ENUM('pending', 'inserted', 'repeat_enquiry', 'rejected');--> statement-breakpoint
CREATE TYPE "app"."sla_clock_mode" AS ENUM('business_hours', 'continuous');--> statement-breakpoint
CREATE TYPE "app"."user_role" AS ENUM('salesperson', 'manager', 'owner', 'agency', 'admin');--> statement-breakpoint
CREATE TYPE "app"."user_status" AS ENUM('invited', 'active', 'disabled');--> statement-breakpoint
CREATE TABLE "app"."assignment_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"priority" integer NOT NULL,
	"name" text NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."attempt_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"event_type" "app"."attempt_event_type" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" "app"."attempt_channel" NOT NULL,
	"initiated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_initiated_at" timestamp with time zone,
	"device" text,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"device" text,
	"ip" "inet",
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."auth_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"destination" text NOT NULL,
	"secret_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."business_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"opens_at" time NOT NULL,
	"closes_at" time NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_hours_weekday_ck" CHECK ("app"."business_hours"."weekday" between 0 and 6)
);
--> statement-breakpoint
CREATE TABLE "app"."daily_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"metric_date" date NOT NULL,
	"dimension" "app"."metric_dimension" NOT NULL,
	"salesperson_id" uuid,
	"campaign_id" text,
	"snapshot_version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"revision_reason" text,
	"calculation_version" integer DEFAULT 1 NOT NULL,
	"event_watermark" timestamp with time zone NOT NULL,
	"leads_received" integer DEFAULT 0 NOT NULL,
	"leads_touched" integer DEFAULT 0 NOT NULL,
	"touched_within_sla" integer DEFAULT 0 NOT NULL,
	"never_touched" integer DEFAULT 0 NOT NULL,
	"median_first_response_seconds" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"connected" integer DEFAULT 0 NOT NULL,
	"visits_booked" integer DEFAULT 0 NOT NULL,
	"visits_done" integer DEFAULT 0 NOT NULL,
	"won" integer DEFAULT 0 NOT NULL,
	"revenue" numeric(14, 2) DEFAULT '0' NOT NULL,
	"quality_flags" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."form_field_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_form_id" uuid NOT NULL,
	"source_field" text NOT NULL,
	"target_field" text NOT NULL,
	"transform" text,
	"required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"normalized" jsonb,
	"status" "app"."import_row_status" DEFAULT 'pending' NOT NULL,
	"lead_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" "app"."lead_source" DEFAULT 'csv_import' NOT NULL,
	"file_name" text NOT NULL,
	"checksum" text NOT NULL,
	"status" "app"."import_status" DEFAULT 'pending' NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"inserted_rows" integer DEFAULT 0 NOT NULL,
	"rejected_rows" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."job_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"status" "app"."job_status" NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "app"."job_status" DEFAULT 'scheduled' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"pg_boss_job_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."lead_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_id" uuid,
	"actor_type" "app"."actor_type" DEFAULT 'system' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"device" text,
	"ip" "inet",
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."lead_sla_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"enquiry_sequence" integer NOT NULL,
	"sla_policy_version_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"first_touch_at" timestamp with time zone,
	"breached_at" timestamp with time zone,
	"breach_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" "app"."lead_source" NOT NULL,
	"external_id" text NOT NULL,
	"form_id" text,
	"form_name" text,
	"campaign_id" text,
	"campaign_name" text,
	"adset_id" text,
	"adset_name" text,
	"ad_id" text,
	"ad_name" text,
	"creative_thumb" text,
	"full_name" text,
	"full_name_raw" text,
	"phone_e164" text,
	"phone_raw" text,
	"email" text,
	"city" text,
	"is_international" boolean DEFAULT false NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stage" "app"."lead_stage" DEFAULT 'new' NOT NULL,
	"conversation_state" "app"."conversation_state" DEFAULT 'waiting_on_us' NOT NULL,
	"assigned_to" uuid,
	"store_id" uuid,
	"enquiry_count" integer DEFAULT 1 NOT NULL,
	"lead_created_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_at" timestamp with time zone,
	"first_viewed_at" timestamp with time zone,
	"first_touch_at" timestamp with time zone,
	"first_connect_at" timestamp with time zone,
	"sla_policy_version_id" uuid NOT NULL,
	"sla_due_at" timestamp with time zone NOT NULL,
	"sla_breached" boolean DEFAULT false NOT NULL,
	"sla_breach_minutes" integer,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"next_action_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"close_reason" "app"."close_reason",
	"quality_flag" "app"."quality_flag" DEFAULT 'unrated' NOT NULL,
	"order_value" numeric(12, 2),
	"hydration_failed" boolean DEFAULT false NOT NULL,
	"source_recovery" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_won_value_ck" CHECK ("app"."leads"."stage" <> 'won' OR "app"."leads"."order_value" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "app"."meta_ad_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ad_id" text NOT NULL,
	"ad_name" text,
	"adset_id" text,
	"adset_name" text,
	"campaign_id" text,
	"campaign_name" text,
	"creative_thumbnail_url" text,
	"spend_inr" numeric(12, 2),
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."meta_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_connection_id" uuid NOT NULL,
	"page_id" text,
	"ad_account_id" text,
	"token_ciphertext" text,
	"encryption_key_version" integer DEFAULT 1 NOT NULL,
	"token_expires_at" timestamp with time zone,
	"last_healthy_at" timestamp with time zone,
	"last_webhook_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"client_initiated_at" timestamp with time zone,
	"device" text,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid,
	"recipient_user_id" uuid NOT NULL,
	"channel" "app"."notification_channel" NOT NULL,
	"template" text NOT NULL,
	"status" "app"."notification_status" DEFAULT 'queued' NOT NULL,
	"deduplication_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_response" jsonb,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"storage_path" text,
	"commentary" text,
	"generated_by" uuid,
	"generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"device" text,
	"ip" "inet",
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."sla_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"policy_family_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"applies_to" text NOT NULL,
	"clock_mode" "app"."sla_clock_mode" NOT NULL,
	"first_touch_target_minutes" integer DEFAULT 5 NOT NULL,
	"salesperson_reminder_minutes" integer[] DEFAULT ARRAY[0,3]::integer[] NOT NULL,
	"manager_escalation_minutes" integer,
	"owner_escalation_minutes" integer NOT NULL,
	"abandoned_minutes" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."source_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" "app"."lead_source" NOT NULL,
	"name" text NOT NULL,
	"status" "app"."connection_status" DEFAULT 'draft' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."source_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."store_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"holiday_date" date NOT NULL,
	"name" text NOT NULL,
	"opens_at" time,
	"closes_at" time,
	"closed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"city" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"month" date NOT NULL,
	"visits_target" integer DEFAULT 0 NOT NULL,
	"won_target" integer DEFAULT 0 NOT NULL,
	"revenue_target" numeric(14, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."tenants" (
	"tenant_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text DEFAULT 'client' NOT NULL,
	"accent_color" text DEFAULT '#7B5EA7' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."user_store_memberships" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_store_memberships_tenant_id_user_id_store_id_pk" PRIMARY KEY("tenant_id","user_id","store_id")
);
--> statement-breakpoint
CREATE TABLE "app"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"phone_e164" text,
	"email" text,
	"role" "app"."user_role" NOT NULL,
	"status" "app"."user_status" DEFAULT 'invited' NOT NULL,
	"store_id" uuid,
	"available" boolean DEFAULT true NOT NULL,
	"shift_starts_at" time,
	"shift_ends_at" time,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" "app"."lead_source" NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_body" text NOT NULL,
	"body_sha256" text NOT NULL,
	"signature_valid" boolean NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."webhook_processing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"webhook_event_id" uuid NOT NULL,
	"status" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_rules_priority_uq" ON "app"."assignment_rules" USING btree ("tenant_id","priority");--> statement-breakpoint
CREATE INDEX "attempt_events_attempt_idx" ON "app"."attempt_events" USING btree ("tenant_id","attempt_id","occurred_at");--> statement-breakpoint
CREATE INDEX "attempts_lead_idx" ON "app"."attempts" USING btree ("tenant_id","lead_id","initiated_at");--> statement-breakpoint
CREATE INDEX "audit_tenant_time_idx" ON "app"."audit_log" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "business_hours_store_day_uq" ON "app"."business_hours" USING btree ("tenant_id","store_id","weekday");--> statement-breakpoint
CREATE INDEX "daily_metrics_lookup_idx" ON "app"."daily_metrics" USING btree ("tenant_id","metric_date","dimension");--> statement-breakpoint
CREATE UNIQUE INDEX "field_map_source_uq" ON "app"."form_field_map" USING btree ("tenant_id","source_form_id","source_field");--> statement-breakpoint
CREATE UNIQUE INDEX "import_rows_number_uq" ON "app"."import_rows" USING btree ("tenant_id","import_id","row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_uq" ON "app"."jobs" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "app"."jobs" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "lead_events_timeline_idx" ON "app"."lead_events" USING btree ("tenant_id","lead_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_sla_cycle_sequence_uq" ON "app"."lead_sla_cycles" USING btree ("tenant_id","lead_id","enquiry_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_external_uq" ON "app"."leads" USING btree ("tenant_id","source","external_id");--> statement-breakpoint
CREATE INDEX "leads_phone_idx" ON "app"."leads" USING btree ("tenant_id","phone_e164");--> statement-breakpoint
CREATE INDEX "leads_today_idx" ON "app"."leads" USING btree ("tenant_id","assigned_to","conversation_state","next_action_at");--> statement-breakpoint
CREATE INDEX "leads_untouched_idx" ON "app"."leads" USING btree ("tenant_id","first_touch_at","sla_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_ad_cache_uq" ON "app"."meta_ad_cache" USING btree ("tenant_id","ad_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_connection_page_uq" ON "app"."meta_connections" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "notes_lead_idx" ON "app"."notes" USING btree ("tenant_id","lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "app"."notifications" USING btree ("tenant_id","deduplication_key");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_period_version_uq" ON "app"."reports" USING btree ("tenant_id","kind","period_start","version");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "app"."sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "app"."sessions" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sla_policy_version_uq" ON "app"."sla_policies" USING btree ("tenant_id","policy_family_id","version");--> statement-breakpoint
CREATE INDEX "sla_policy_effective_idx" ON "app"."sla_policies" USING btree ("tenant_id","applies_to","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "source_forms_external_uq" ON "app"."source_forms" USING btree ("tenant_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_holidays_date_uq" ON "app"."store_holidays" USING btree ("tenant_id","store_id","holiday_date");--> statement-breakpoint
CREATE UNIQUE INDEX "stores_tenant_slug_uq" ON "app"."stores" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "targets_user_month_uq" ON "app"."targets" USING btree ("tenant_id","user_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_uq" ON "app"."tenants" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_uq" ON "app"."users" USING btree ("tenant_id","phone_e164");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "app"."users" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "users_roster_idx" ON "app"."users" USING btree ("tenant_id","store_id","available");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_digest_uq" ON "app"."webhook_events" USING btree ("tenant_id","body_sha256","received_at");