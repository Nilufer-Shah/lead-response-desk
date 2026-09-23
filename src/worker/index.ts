import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";
import { snapshotDailyMetrics } from "@/services/daily-metrics";
import { runIntegrityAudit } from "@/services/integrity";
import { processSlaEscalations } from "@/services/escalations";
import { processFollowupCadence } from "@/services/followups";
import { queueDailyOwnerDigest } from "@/services/digest";
import { generateWeeklyPdf } from "@/services/weekly-report";
import { deliverQueuedNotifications } from "@/services/notification-delivery";
import { syncGoogleSheetConnection } from "@/services/google-sheets-sync";
import { processMetaWebhookEvent, reconcileMetaLeads } from "@/services/meta-leads";

type TenantJob = { tenantId: string; webhookEventId?: string; jobId?: string; leadId?: string; reportId?: string; periodStart?: string; periodEnd?: string; commentary?: string };

const boss = new PgBoss({ connectionString: env().DATABASE_URL, schema: "pgboss", application_name: "lead-response-worker" });

async function registerQueue(name: string) {
  await boss.createQueue(name, { policy: "singletonKey" });
}

async function main() {
  boss.on("error", (error) => process.stderr.write(`${error.stack ?? error.message}\n`));
  await boss.start();

  const queues = ["sla.check", "followup.due", "notification.send", "metrics.daily", "digest.daily", "report.weekly", "integrity.daily", "webhook.recover", "meta.process", "meta.reconcile", "google-sheets.sync"];
  await Promise.all(queues.map(registerQueue));

  await boss.work<TenantJob>("sla.check", async (jobs) => {
    for (const job of jobs) {
      const queued = await processSlaEscalations(job.data.tenantId);
      process.stdout.write(`SLA check ${job.data.tenantId}: ${queued} alerts queued\n`);
    }
  });
  await boss.work<TenantJob>("followup.due", async (jobs) => {
    for (const job of jobs) {
      const result = await processFollowupCadence(job.data.tenantId);
      process.stdout.write(`Follow-up cadence ${job.data.tenantId}: ${result.due} due, ${result.missed} missed, ${result.dormant} dormant\n`);
    }
  });
  await boss.work<TenantJob>("notification.send", async (jobs) => {
    for (const job of jobs) {
      const result = await deliverQueuedNotifications(job.data.tenantId);
      process.stdout.write(`Notification delivery ${job.data.tenantId}: ${result.delivered}/${result.processed}\n`);
    }
  });
  await boss.work<TenantJob>("metrics.daily", async (jobs) => {
    for (const job of jobs) {
      const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const written = await snapshotDailyMetrics(job.data.tenantId, date);
      process.stdout.write(`Daily snapshot ${job.data.tenantId}: ${written} rows\n`);
    }
  });
  await boss.work<TenantJob>("report.weekly", async (jobs) => {
    for (const job of jobs) {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const monday = new Date(`${today}T00:00:00+05:30`);
      const dateInIndia = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
      const periodStart = job.data.periodStart ?? dateInIndia(new Date(monday.getTime() - 7 * 86_400_000));
      const periodEnd = job.data.periodEnd ?? dateInIndia(new Date(monday.getTime() - 86_400_000));
      const report = await generateWeeklyPdf(job.data.tenantId, periodStart, periodEnd, job.data.commentary);
      process.stdout.write(`Weekly report ${job.data.tenantId}: ${report.reportId}\n`);
    }
  });
  await boss.work<TenantJob>("digest.daily", async (jobs) => {
    for (const job of jobs) {
      const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      await queueDailyOwnerDigest(job.data.tenantId, date);
      process.stdout.write(`Daily digest ${job.data.tenantId}: queued\n`);
    }
  });
  await boss.work<TenantJob>("integrity.daily", async (jobs) => {
    for (const job of jobs) {
      await runIntegrityAudit(job.data.tenantId);
      process.stdout.write(`Integrity check ${job.data.tenantId}: healthy\n`);
    }
  });
  await boss.work<TenantJob>("webhook.recover", async (jobs) => {
    for (const job of jobs) process.stdout.write(`Webhook spool recovery ${job.data.tenantId}\n`);
  });
  await boss.work<TenantJob>("google-sheets.sync", async (jobs) => {
    for (const job of jobs) {
      const result = await syncGoogleSheetConnection(job.data.tenantId);
      process.stdout.write(`Google Sheets sync ${job.data.tenantId}: ${result.inserted} new, ${result.repeats} repeats, ${result.unchanged} unchanged\n`);
    }
  });
  await boss.work<TenantJob>("meta.process", async (jobs) => {
    for (const job of jobs) {
      if (!job.data.webhookEventId) throw new Error("Meta processing job is missing webhookEventId");
      const result = await processMetaWebhookEvent(job.data.tenantId, job.data.webhookEventId);
      process.stdout.write(`Meta webhook ${job.data.webhookEventId}: ${result.ingested} lead(s) processed\n`);
    }
  });
  await boss.work<TenantJob>("meta.reconcile", async (jobs) => {
    for (const job of jobs) {
      const result = await reconcileMetaLeads(job.data.tenantId);
      process.stdout.write(`Meta reconciliation ${job.data.tenantId}: ${result.inserted} new, ${result.unchanged} already present\n`);
    }
  });

  const tenantId = env().DEFAULT_TENANT_ID;
  await boss.schedule("sla.check", "* * * * *", { tenantId }, { tz: "Asia/Kolkata", key: "roopkala-sla-minute" });
  await boss.schedule("followup.due", "* * * * *", { tenantId }, { tz: "Asia/Kolkata", key: "roopkala-followup-minute" });
  await boss.schedule("notification.send", "* * * * *", { tenantId }, { tz: "Asia/Kolkata", key: "roopkala-notification-minute" });
  await boss.schedule("metrics.daily", "55 23 * * *", { tenantId }, { tz: "Asia/Kolkata", key: "roopkala-daily" });
  await boss.schedule("digest.daily", "15 21 * * *", { tenantId }, { tz: "Asia/Kolkata", key: "roopkala-digest" });
  await boss.schedule("report.weekly", "0 10 * * 1", { tenantId }, { tz: "Asia/Kolkata", key: "roopkala-weekly" });
  await boss.schedule("integrity.daily", "20 2 * * *", { tenantId }, { tz: "Asia/Kolkata", key: "roopkala-integrity" });
  if (env().GOOGLE_SHEETS_ENABLED === "true") {
    await boss.schedule("google-sheets.sync", `*/${env().GOOGLE_SHEETS_POLL_MINUTES} * * * *`, { tenantId }, { tz: "Asia/Kolkata", key: "google-sheets-poll" });
  }
  if (env().META_CONNECTION_ENABLED === "true") {
    await boss.schedule("meta.reconcile", "*/15 * * * *", { tenantId }, { tz: "Asia/Kolkata", key: "meta-reconcile-15m" });
  }

  process.stdout.write("Lead Response Desk worker ready\n");
}

async function shutdown() { await boss.stop({ graceful: true, timeout: 30_000 }); process.exit(0); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
void main();
