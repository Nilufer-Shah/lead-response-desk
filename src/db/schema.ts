import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const app = pgSchema("app");

export const userRole = app.enum("user_role", ["owner", "salesperson", "agency"]);
export const userStatus = app.enum("user_status", ["invited", "active", "disabled"]);
export const leadSource = app.enum("lead_source", [
  "meta_lead_form", "csv_import", "whatsapp", "instagram_dm", "instagram_comment",
  "instagram_story_reply", "website_form", "website_whatsapp", "walk_in",
  "phone_inbound", "referral", "other",
]);
export const leadStage = app.enum("lead_stage", ["new", "contacted", "follow_up", "dormant", "won", "dead", "bad"]);
export const followupStatus = app.enum("followup_status", ["pending", "done", "missed", "cancelled"]);
export const followupAnswer = app.enum("followup_answer", ["yes", "no"]);
export const conversationState = app.enum("conversation_state", ["waiting_on_us", "waiting_on_lead", "scheduled", "closed"]);
export const qualityFlag = app.enum("quality_flag", ["unrated", "good", "invalid_number", "wrong_person", "out_of_area", "budget_mismatch", "competitor", "spam", "duplicate"]);
export const closeReason = app.enum("close_reason", ["bought", "bought_elsewhere", "price_too_high", "out_of_area", "just_browsing", "unreachable", "wrong_number", "invalid_number", "duplicate", "spam", "no_response"]);
export const actorType = app.enum("actor_type", ["system", "user", "client", "agency"]);
export const attemptChannel = app.enum("attempt_channel", ["call", "whatsapp", "sms", "email", "in_person"]);
export const attemptEventType = app.enum("attempt_event_type", ["disposition_logged", "whatsapp_queued", "whatsapp_sent", "whatsapp_delivered", "whatsapp_read", "whatsapp_replied", "whatsapp_failed", "duration_reported", "note_added"]);
export const slaClockMode = app.enum("sla_clock_mode", ["business_hours", "continuous"]);
export const connectionStatus = app.enum("connection_status", ["draft", "healthy", "degraded", "disabled"]);
export const importStatus = app.enum("import_status", ["pending", "processing", "completed", "failed"]);
export const rowStatus = app.enum("import_row_status", ["pending", "inserted", "repeat_enquiry", "rejected"]);
export const jobStatus = app.enum("job_status", ["scheduled", "running", "completed", "failed", "cancelled"]);
export const notificationStatus = app.enum("notification_status", ["queued", "sent", "delivered", "failed", "cancelled"]);
export const notificationChannel = app.enum("notification_channel", ["whatsapp", "push", "email"]);
export const metricDimension = app.enum("metric_dimension", ["tenant", "salesperson", "campaign"]);

const id = () => uuid("id").defaultRandom().primaryKey();
const tenantId = () => uuid("tenant_id").notNull();
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

export const tenants = app.table("tenants", {
  tenantId: uuid("tenant_id").defaultRandom().primaryKey(),
  clientName: text("client_name").notNull(),
  slug: text("slug").notNull(),
  kind: text("kind").default("client").notNull(),
  accentColor: text("accent_color").default("#7B5EA7").notNull(),
  timezone: text("timezone").default("Asia/Kolkata").notNull(),
  currency: text("currency").default("INR").notNull(),
  active: boolean("active").default(true).notNull(), followupDays: integer("followup_days").default(4).notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("tenants_slug_uq").on(table.slug)]);

export const stores = app.table("stores", {
  id: id(), tenantId: tenantId(), name: text("name").notNull(), slug: text("slug").notNull(),
  timezone: text("timezone").default("Asia/Kolkata").notNull(), city: text("city"),
  isDefault: boolean("is_default").default(false).notNull(), active: boolean("active").default(true).notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("stores_tenant_slug_uq").on(table.tenantId, table.slug)]);

export const users = app.table("users", {
  id: id(), tenantId: tenantId(), displayName: text("display_name").notNull(),
  phoneE164: text("phone_e164"), email: text("email"), role: userRole("role").notNull(),
  status: userStatus("status").default("invited").notNull(), storeId: uuid("store_id"),
  available: boolean("available").default(true).notNull(), passwordHash: text("password_hash"),
  passwordResetRequired: boolean("password_reset_required").default(false).notNull(),
  shiftStartsAt: time("shift_starts_at"), shiftEndsAt: time("shift_ends_at"),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("users_phone_uq").on(table.tenantId, table.phoneE164),
  uniqueIndex("users_email_uq").on(table.tenantId, table.email),
  index("users_roster_idx").on(table.tenantId, table.storeId, table.available),
]);

export const authChallenges = app.table("auth_challenges", {
  id: id(), tenantId: tenantId(), userId: uuid("user_id").notNull(), kind: text("kind").notNull(),
  destination: text("destination").notNull(), secretHash: text("secret_hash").notNull(),
  attempts: integer("attempts").default(0).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }), createdAt: createdAt(), updatedAt: updatedAt(),
});

export const sessions = app.table("sessions", {
  id: id(), tenantId: tenantId(), userId: uuid("user_id").notNull(), tokenHash: text("token_hash").notNull(),
  device: text("device"), ip: inet("ip"), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("sessions_token_uq").on(table.tokenHash), index("sessions_user_idx").on(table.tenantId, table.userId)]);

export const businessHours = app.table("business_hours", {
  id: id(), tenantId: tenantId(), storeId: uuid("store_id").notNull(), weekday: integer("weekday").notNull(),
  opensAt: time("opens_at").notNull(), closesAt: time("closes_at").notNull(), enabled: boolean("enabled").default(true).notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("business_hours_store_day_uq").on(table.tenantId, table.storeId, table.weekday), check("business_hours_weekday_ck", sql`${table.weekday} between 0 and 6`)]);

export const storeHolidays = app.table("store_holidays", {
  id: id(), tenantId: tenantId(), storeId: uuid("store_id").notNull(), holidayDate: date("holiday_date").notNull(),
  name: text("name").notNull(), opensAt: time("opens_at"), closesAt: time("closes_at"), closed: boolean("closed").default(true).notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("store_holidays_date_uq").on(table.tenantId, table.storeId, table.holidayDate)]);

export const slaPolicies = app.table("sla_policies", {
  id: id(), tenantId: tenantId(), policyFamilyId: uuid("policy_family_id").notNull(), version: integer("version").notNull(),
  name: text("name").notNull(), appliesTo: text("applies_to").notNull(), clockMode: slaClockMode("clock_mode").notNull(),
  firstTouchTargetMinutes: integer("first_touch_target_minutes").default(5).notNull(),
  salespersonReminderMinutes: integer("salesperson_reminder_minutes").array().default(sql`ARRAY[0,3]::integer[]`).notNull(),
  managerEscalationMinutes: integer("manager_escalation_minutes"), ownerEscalationMinutes: integer("owner_escalation_minutes").notNull(),
  abandonedMinutes: integer("abandoned_minutes").notNull(), effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by"), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("sla_policy_version_uq").on(table.tenantId, table.policyFamilyId, table.version), index("sla_policy_effective_idx").on(table.tenantId, table.appliesTo, table.effectiveFrom)]);

export const sourceConnections = app.table("source_connections", {
  id: id(), tenantId: tenantId(), source: leadSource("source").notNull(), name: text("name").notNull(),
  status: connectionStatus("status").default("draft").notNull(), config: jsonb("config").default({}).notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const googleSheetConnections = app.table("google_sheet_connections", {
  id: id(), tenantId: tenantId(), sourceConnectionId: uuid("source_connection_id").notNull(),
  spreadsheetId: text("spreadsheet_id").notNull(), sheetName: text("sheet_name").notNull(),
  headerRow: integer("header_row").default(1).notNull(), mapping: jsonb("mapping").default({}).notNull(),
  enabled: boolean("enabled").default(false).notNull(), createdBy: uuid("created_by").notNull(),
  importAfter: timestamp("import_after", { withTimezone: true }).defaultNow().notNull(),
  lastSyncedRow: integer("last_synced_row").default(0).notNull(), lastFullCheckAt: timestamp("last_full_check_at", { withTimezone: true }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }), lastHealthyAt: timestamp("last_healthy_at", { withTimezone: true }),
  lastError: text("last_error"), lastSkippedRows: integer("last_skipped_rows").default(0).notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("google_sheet_connection_source_uq").on(table.tenantId, table.sourceConnectionId),
  uniqueIndex("google_sheet_connection_sheet_uq").on(table.tenantId, table.spreadsheetId, table.sheetName),
  check("google_sheet_header_row_ck", sql`${table.headerRow} between 1 and 100`),
]);

export const googleSheetSyncRuns = app.table("google_sheet_sync_runs", {
  id: id(), tenantId: tenantId(), googleSheetConnectionId: uuid("google_sheet_connection_id").notNull(),
  status: text("status").notNull(), rowsSeen: integer("rows_seen").default(0).notNull(),
  insertedRows: integer("inserted_rows").default(0).notNull(), repeatRows: integer("repeat_rows").default(0).notNull(),
  rejectedRows: integer("rejected_rows").default(0).notNull(), skippedRows: integer("skipped_rows").default(0).notNull(),
  unchangedRows: integer("unchanged_rows").default(0).notNull(), error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [index("google_sheet_sync_runs_lookup_idx").on(table.tenantId, table.googleSheetConnectionId, table.startedAt)]);

export const metaConnections = app.table("meta_connections", {
  id: id(), tenantId: tenantId(), sourceConnectionId: uuid("source_connection_id").notNull(),
  pageId: text("page_id"), adAccountId: text("ad_account_id"), tokenCiphertext: text("token_ciphertext"),
  encryptionKeyVersion: integer("encryption_key_version").default(1).notNull(), tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  lastHealthyAt: timestamp("last_healthy_at", { withTimezone: true }), lastWebhookAt: timestamp("last_webhook_at", { withTimezone: true }),
  lastReconciledAt: timestamp("last_reconciled_at", { withTimezone: true }), lastReconciliationResult: jsonb("last_reconciliation_result").default({}).notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("meta_connection_page_uq").on(table.pageId), uniqueIndex("meta_connection_source_uq").on(table.tenantId, table.sourceConnectionId)]);

export const sourceForms = app.table("source_forms", {
  id: id(), tenantId: tenantId(), sourceConnectionId: uuid("source_connection_id").notNull(),
  externalId: text("external_id").notNull(), name: text("name").notNull(), active: boolean("active").default(true).notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("source_forms_external_uq").on(table.tenantId, table.externalId)]);

export const formFieldMap = app.table("form_field_map", {
  id: id(), tenantId: tenantId(), sourceFormId: uuid("source_form_id").notNull(), sourceField: text("source_field").notNull(),
  targetField: text("target_field").notNull(), transform: text("transform"), required: boolean("required").default(false).notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("field_map_source_uq").on(table.tenantId, table.sourceFormId, table.sourceField)]);

export const metaAdCache = app.table("meta_ad_cache", {
  id: id(), tenantId: tenantId(), adId: text("ad_id").notNull(), adName: text("ad_name"), adsetId: text("adset_id"),
  adsetName: text("adset_name"), campaignId: text("campaign_id"), campaignName: text("campaign_name"),
  creativeThumbnailUrl: text("creative_thumbnail_url"), spendInr: numeric("spend_inr", { precision: 12, scale: 2 }),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }).defaultNow().notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("meta_ad_cache_uq").on(table.tenantId, table.adId)]);

export const leads = app.table("leads", {
  id: id(), tenantId: tenantId(), source: leadSource("source").notNull(), externalId: text("external_id").notNull(),
  formId: text("form_id"), formName: text("form_name"), campaignId: text("campaign_id"), campaignName: text("campaign_name"),
  adsetId: text("adset_id"), adsetName: text("adset_name"), adId: text("ad_id"), adName: text("ad_name"), creativeThumb: text("creative_thumb"),
  fullName: text("full_name"), fullNameRaw: text("full_name_raw"), phoneE164: text("phone_e164"), phoneRaw: text("phone_raw"),
  email: text("email"), city: text("city"), metaLeadId: text("meta_lead_id"), isInternational: boolean("is_international").default(false).notNull(),
  customFields: jsonb("custom_fields").default({}).notNull(), stage: leadStage("stage").default("new").notNull(),
  conversationState: conversationState("conversation_state").default("waiting_on_us").notNull(), assignedTo: uuid("assigned_to"), storeId: uuid("store_id"),
  enquiryCount: integer("enquiry_count").default(1).notNull(), leadCreatedAt: timestamp("lead_created_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(), assignedAt: timestamp("assigned_at", { withTimezone: true }),
  firstViewedAt: timestamp("first_viewed_at", { withTimezone: true }), firstTouchAt: timestamp("first_touch_at", { withTimezone: true }),
  firstContactedAt: timestamp("first_contacted_at", { withTimezone: true }), firstResponseMinutes: integer("first_response_minutes"),
  firstConnectAt: timestamp("first_connect_at", { withTimezone: true }), slaPolicyVersionId: uuid("sla_policy_version_id").notNull(),
  slaDueAt: timestamp("sla_due_at", { withTimezone: true }).notNull(), slaBreached: boolean("sla_breached").default(false).notNull(),
  slaBreachMinutes: integer("sla_breach_minutes"), attemptCount: integer("attempt_count").default(0).notNull(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }), nextActionAt: timestamp("next_action_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }), closedBy: uuid("closed_by"), outcomeReason: text("outcome_reason"), closeReason: closeReason("close_reason"),
  qualityFlag: qualityFlag("quality_flag").default("unrated").notNull(), orderValue: numeric("order_value", { precision: 12, scale: 2 }),
  hydrationFailed: boolean("hydration_failed").default(false).notNull(), sourceRecovery: boolean("source_recovery").default(false).notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("leads_external_uq").on(table.tenantId, table.source, table.externalId),
  uniqueIndex("leads_meta_lead_id_uq").on(table.tenantId, table.metaLeadId),
  index("leads_phone_idx").on(table.tenantId, table.phoneE164),
  index("leads_today_idx").on(table.tenantId, table.assignedTo, table.conversationState, table.nextActionAt),
  index("leads_untouched_idx").on(table.tenantId, table.firstTouchAt, table.slaDueAt),
  check("leads_won_value_ck", sql`${table.stage} <> 'won' OR ${table.orderValue} IS NOT NULL`),
]);

export const leadSlaCycles = app.table("lead_sla_cycles", {
  id: id(), tenantId: tenantId(), leadId: uuid("lead_id").notNull(), enquirySequence: integer("enquiry_sequence").notNull(),
  slaPolicyVersionId: uuid("sla_policy_version_id").notNull(), startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(), firstTouchAt: timestamp("first_touch_at", { withTimezone: true }),
  breachedAt: timestamp("breached_at", { withTimezone: true }), breachMinutes: integer("breach_minutes"),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("lead_sla_cycle_sequence_uq").on(table.tenantId, table.leadId, table.enquirySequence)]);

export const leadEvents = app.table("lead_events", {
  id: id(), tenantId: tenantId(), leadId: uuid("lead_id").notNull(), eventType: text("event_type").notNull(),
  actorId: uuid("actor_id"), actorType: actorType("actor_type").default("system").notNull(), payload: jsonb("payload").default({}).notNull(),
  device: text("device"), ip: inet("ip"), occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [index("lead_events_timeline_idx").on(table.tenantId, table.leadId, table.occurredAt)]);

export const attempts = app.table("attempts", {
  id: id(), tenantId: tenantId(), leadId: uuid("lead_id").notNull(), userId: uuid("user_id").notNull(), channel: attemptChannel("channel").notNull(),
  initiatedAt: timestamp("initiated_at", { withTimezone: true }).defaultNow().notNull(), clientInitiatedAt: timestamp("client_initiated_at", { withTimezone: true }),
  device: text("device"), ip: inet("ip"), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [index("attempts_lead_idx").on(table.tenantId, table.leadId, table.initiatedAt)]);

export const attemptEvents = app.table("attempt_events", {
  id: id(), tenantId: tenantId(), attemptId: uuid("attempt_id").notNull(), eventType: attemptEventType("event_type").notNull(),
  payload: jsonb("payload").default({}).notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [index("attempt_events_attempt_idx").on(table.tenantId, table.attemptId, table.occurredAt)]);

export const notes = app.table("notes", {
  id: id(), tenantId: tenantId(), leadId: uuid("lead_id").notNull(), userId: uuid("user_id").notNull(), body: text("body").notNull(),
  clientInitiatedAt: timestamp("client_initiated_at", { withTimezone: true }), device: text("device"), ip: inet("ip"),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [index("notes_lead_idx").on(table.tenantId, table.leadId, table.createdAt)]);

export const leadFollowups = app.table("lead_followups", {
  id: id(), tenantId: tenantId(), leadId: uuid("lead_id").notNull(), dayNumber: integer("day_number").notNull(),
  dueDate: date("due_date").notNull(), status: followupStatus("status").default("pending").notNull(),
  answer: followupAnswer("answer"), note: text("note"), attemptId: uuid("attempt_id"),
  answeredAt: timestamp("answered_at", { withTimezone: true }), answeredBy: uuid("answered_by"),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [
  index("lead_followups_due_idx").on(table.tenantId, table.status, table.dueDate),
]);

export const webhookEvents = app.table("webhook_events", {
  id: id(), tenantId: tenantId(), source: leadSource("source").notNull(), headers: jsonb("headers").default({}).notNull(),
  rawBody: text("raw_body").notNull(), bodySha256: text("body_sha256").notNull(), signatureValid: boolean("signature_valid").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("webhook_digest_uq").on(table.tenantId, table.bodySha256, table.receivedAt)]);

export const webhookProcessingEvents = app.table("webhook_processing_events", {
  id: id(), tenantId: tenantId(), webhookEventId: uuid("webhook_event_id").notNull(), status: text("status").notNull(),
  detail: jsonb("detail").default({}).notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const imports = app.table("imports", {
  id: id(), tenantId: tenantId(), source: leadSource("source").default("csv_import").notNull(), fileName: text("file_name").notNull(),
  checksum: text("checksum").notNull(), status: importStatus("status").default("pending").notNull(), mapping: jsonb("mapping").default({}).notNull(),
  totalRows: integer("total_rows").default(0).notNull(), insertedRows: integer("inserted_rows").default(0).notNull(),
  rejectedRows: integer("rejected_rows").default(0).notNull(), createdBy: uuid("created_by").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }), createdAt: createdAt(), updatedAt: updatedAt(),
});

export const importRows = app.table("import_rows", {
  id: id(), tenantId: tenantId(), importId: uuid("import_id").notNull(), rowNumber: integer("row_number").notNull(),
  raw: jsonb("raw").notNull(), normalized: jsonb("normalized"), status: rowStatus("status").default("pending").notNull(),
  leadId: uuid("lead_id"), error: text("error"), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("import_rows_number_uq").on(table.tenantId, table.importId, table.rowNumber)]);

export const assignmentRules = app.table("assignment_rules", {
  id: id(), tenantId: tenantId(), priority: integer("priority").notNull(), name: text("name").notNull(),
  conditions: jsonb("conditions").default({}).notNull(), action: jsonb("action").notNull(), active: boolean("active").default(true).notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("assignment_rules_priority_uq").on(table.tenantId, table.priority)]);

export const jobs = app.table("jobs", {
  id: id(), tenantId: tenantId(), kind: text("kind").notNull(), idempotencyKey: text("idempotency_key").notNull(),
  status: jobStatus("status").default("scheduled").notNull(), payload: jsonb("payload").default({}).notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(), pgBossJobId: text("pg_boss_job_id"),
  attempts: integer("attempts").default(0).notNull(), lastError: text("last_error"), completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("jobs_idempotency_uq").on(table.tenantId, table.idempotencyKey), index("jobs_due_idx").on(table.status, table.scheduledAt)]);

export const jobEvents = app.table("job_events", {
  id: id(), tenantId: tenantId(), jobId: uuid("job_id").notNull(), status: jobStatus("status").notNull(),
  detail: jsonb("detail").default({}).notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const notifications = app.table("notifications", {
  id: id(), tenantId: tenantId(), leadId: uuid("lead_id"), recipientUserId: uuid("recipient_user_id").notNull(),
  channel: notificationChannel("channel").notNull(), template: text("template").notNull(), status: notificationStatus("status").default("queued").notNull(),
  deduplicationKey: text("deduplication_key").notNull(), payload: jsonb("payload").default({}).notNull(), providerResponse: jsonb("provider_response"),
  sentAt: timestamp("sent_at", { withTimezone: true }), deliveredAt: timestamp("delivered_at", { withTimezone: true }), failedAt: timestamp("failed_at", { withTimezone: true }),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("notifications_dedupe_uq").on(table.tenantId, table.deduplicationKey)]);

export const reports = app.table("reports", {
  id: id(), tenantId: tenantId(), kind: text("kind").notNull(), periodStart: date("period_start").notNull(), periodEnd: date("period_end").notNull(),
  version: integer("version").default(1).notNull(), status: text("status").default("queued").notNull(), storagePath: text("storage_path"),
  commentary: text("commentary"), generatedBy: uuid("generated_by"), generatedAt: timestamp("generated_at", { withTimezone: true }),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("reports_period_version_uq").on(table.tenantId, table.kind, table.periodStart, table.version)]);

export const dailyMetrics = app.table("daily_metrics", {
  id: id(), tenantId: tenantId(), metricDate: date("metric_date").notNull(), dimension: metricDimension("dimension").notNull(),
  salespersonId: uuid("salesperson_id"), campaignId: text("campaign_id"), snapshotVersion: integer("snapshot_version").default(1).notNull(),
  supersedesId: uuid("supersedes_id"), revisionReason: text("revision_reason"), calculationVersion: integer("calculation_version").default(1).notNull(),
  eventWatermark: timestamp("event_watermark", { withTimezone: true }).notNull(), leadsReceived: integer("leads_received").default(0).notNull(),
  leadsTouched: integer("leads_touched").default(0).notNull(), touchedWithinSla: integer("touched_within_sla").default(0).notNull(),
  neverTouched: integer("never_touched").default(0).notNull(), medianFirstResponseSeconds: integer("median_first_response_seconds"),
  attempts: integer("attempts").default(0).notNull(), connected: integer("connected").default(0).notNull(),
  visitsBooked: integer("visits_booked").default(0).notNull(), visitsDone: integer("visits_done").default(0).notNull(),
  won: integer("won").default(0).notNull(), revenue: numeric("revenue", { precision: 14, scale: 2 }).default("0").notNull(),
  qualityFlags: integer("quality_flags").default(0).notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [index("daily_metrics_lookup_idx").on(table.tenantId, table.metricDate, table.dimension)]);

export const targets = app.table("targets", {
  id: id(), tenantId: tenantId(), userId: uuid("user_id").notNull(), month: date("month").notNull(),
  visitsTarget: integer("visits_target").default(0).notNull(), wonTarget: integer("won_target").default(0).notNull(),
  revenueTarget: numeric("revenue_target", { precision: 14, scale: 2 }).default("0").notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("targets_user_month_uq").on(table.tenantId, table.userId, table.month)]);

export const auditLog = app.table("audit_log", {
  id: id(), tenantId: tenantId(), actorId: uuid("actor_id"), action: text("action").notNull(),
  targetType: text("target_type").notNull(), targetId: text("target_id"), payload: jsonb("payload").default({}).notNull(),
  device: text("device"), ip: inet("ip"), occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [index("audit_tenant_time_idx").on(table.tenantId, table.occurredAt)]);

export const userStoreMemberships = app.table("user_store_memberships", {
  tenantId: tenantId(), userId: uuid("user_id").notNull(), storeId: uuid("store_id").notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [primaryKey({ columns: [table.tenantId, table.userId, table.storeId] })]);
