import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };

export function sqlClient() {
  if (!globalForDb.sql) {
    globalForDb.sql = postgres(env().DATABASE_URL, {
      max: env().NODE_ENV === "production" ? 20 : 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  }
  return globalForDb.sql;
}

export function database() {
  return drizzle(sqlClient(), { schema });
}

export async function closeDatabase() {
  if (globalForDb.sql) {
    await globalForDb.sql.end();
    globalForDb.sql = undefined;
  }
}

export async function withTenant<T>(
  context: { tenantId: string; userId?: string; userRole?: string; id?: string; role?: string },
  work: (sql: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return (await sqlClient().begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${context.tenantId}, true)`;
    await transaction`SELECT set_config('app.user_id', ${context.userId ?? context.id ?? ""}, true)`;
    await transaction`SELECT set_config('app.user_role', ${context.userRole ?? context.role ?? "system"}, true)`;
    return work(transaction);
  })) as T;
}
