import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";

const queueGlobal = globalThis as unknown as { leadDeskBoss?: PgBoss; leadDeskBossStarted?: Promise<PgBoss> };

export function webJobQueue(): Promise<PgBoss> {
  if (!queueGlobal.leadDeskBossStarted) {
    const boss = new PgBoss({ connectionString: env().DATABASE_URL, schema: "pgboss", createSchema: false, application_name: "lead-response-web" });
    boss.on("error", (error) => console.error("Job queue error", error));
    queueGlobal.leadDeskBoss = boss;
    queueGlobal.leadDeskBossStarted = boss.start().then(async () => { await boss.createQueue("meta.process", { policy: "singleton" }); return boss; });
  }
  return queueGlobal.leadDeskBossStarted;
}

export async function enqueueMetaWebhook(tenantId: string, webhookEventId: string): Promise<string | null> {
  const boss = await webJobQueue();
  return boss.send("meta.process", { tenantId, webhookEventId }, { retryLimit: 6, retryDelay: 30, retryBackoff: true, singletonKey: webhookEventId });
}
