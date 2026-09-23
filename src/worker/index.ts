import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";
import { processFollowupCadence } from "@/services/followups";
import { syncGoogleSheetConnection } from "@/services/google-sheets-sync";
import { processMetaWebhookEvent, reconcileMetaLeads } from "@/services/meta-leads";

type TenantJob = { tenantId: string; webhookEventId?: string };

const boss = new PgBoss({ connectionString: env().DATABASE_URL, schema: "pgboss", createSchema: false, application_name: "lead-response-worker" });

async function registerQueue(name: string) {
  await boss.createQueue(name, { policy: "singleton" });
}

async function main() {
  boss.on("error", (error) => process.stderr.write(`${error.stack ?? error.message}\n`));
  await boss.start();

  const queues = ["followup.due", "meta.process", "meta.reconcile", "google-sheets.sync"];
  await Promise.all(queues.map(registerQueue));

  await boss.work<TenantJob>("followup.due", async (jobs) => {
    for (const job of jobs) {
      const result = await processFollowupCadence(job.data.tenantId);
      process.stdout.write(`Follow-up cadence ${job.data.tenantId}: ${result.due} due, ${result.missed} missed, ${result.dormant} dormant\n`);
    }
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
  await boss.schedule("followup.due", "* * * * *", { tenantId }, { tz: "Asia/Kolkata", key: "roopkala-followup-minute" });
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
