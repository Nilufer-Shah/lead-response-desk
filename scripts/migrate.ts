import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import { env } from "../src/lib/env";

const SYSTEM_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const sql = postgres(env().DATABASE_URL, { max: 1, prepare: false });
const directory = resolve(process.cwd(), "src/db/migrations");

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS public.lrd_schema_migrations (
      tenant_id uuid NOT NULL DEFAULT '${SYSTEM_TENANT_ID}',
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE public.lrd_schema_migrations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.lrd_schema_migrations FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS migration_tenant_isolation ON public.lrd_schema_migrations;
    CREATE POLICY migration_tenant_isolation ON public.lrd_schema_migrations
      USING (tenant_id = '${SYSTEM_TENANT_ID}'::uuid)
      WITH CHECK (tenant_id = '${SYSTEM_TENANT_ID}'::uuid);
  `);
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const applied = await sql<{ name: string; checksum: string }[]>`SELECT name, checksum FROM public.lrd_schema_migrations`;
  const appliedByName = new Map(applied.map((row) => [row.name, row.checksum]));

  for (const name of files) {
    const content = await readFile(resolve(directory, name), "utf8");
    const checksum = createHash("sha256").update(content).digest("hex");
    const previous = appliedByName.get(name);
    if (previous && previous !== checksum) throw new Error(`Applied migration ${name} was modified`);
    if (previous) continue;
    await sql.begin(async (transaction) => {
      await transaction.unsafe(content.replaceAll("--> statement-breakpoint", ""));
      await transaction`INSERT INTO public.lrd_schema_migrations (tenant_id, name, checksum) VALUES (${SYSTEM_TENANT_ID}, ${name}, ${checksum})`;
    });
    process.stdout.write(`Applied ${name}\n`);
  }
}

main().finally(() => sql.end());
