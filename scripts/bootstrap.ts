import postgres from "postgres";
import { env } from "../src/lib/env";

const settings = env();
const sql = postgres(settings.DATABASE_URL, { max: 1, prepare: false });

async function main() {
  if (!settings.BOOTSTRAP_ADMIN_EMAIL) {
    if (settings.NODE_ENV === "production") throw new Error("BOOTSTRAP_ADMIN_EMAIL is required for a fresh production deployment");
    process.stdout.write("Bootstrap skipped: BOOTSTRAP_ADMIN_EMAIL is not set\n");
    return;
  }
  const adminEmail = settings.BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
  await sql.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${settings.DEFAULT_TENANT_ID}, true)`;
    await transaction`SELECT set_config('app.user_role', 'system', true)`;
    const [admin] = await transaction<{ id: string }[]>`
      INSERT INTO app.users (tenant_id, display_name, email, role, status, available)
      VALUES (${settings.DEFAULT_TENANT_ID}, ${settings.BOOTSTRAP_ADMIN_NAME}, ${adminEmail}, 'admin', 'active', true)
      ON CONFLICT (tenant_id, email) DO UPDATE SET display_name=excluded.display_name, status='active'
      RETURNING id
    `;
    await transaction`
      INSERT INTO app.audit_log (tenant_id, actor_id, action, target_type, target_id, payload)
      SELECT ${settings.DEFAULT_TENANT_ID}, NULL, 'bootstrap_admin_ready', 'user', ${admin.id}, ${transaction.json({ email: adminEmail })}
      WHERE NOT EXISTS (SELECT 1 FROM app.audit_log WHERE tenant_id=${settings.DEFAULT_TENANT_ID} AND action='bootstrap_admin_ready' AND target_id=${admin.id})
    `;
  });
  process.stdout.write(`Bootstrap administrator ready: ${settings.BOOTSTRAP_ADMIN_EMAIL}\n`);
}

main().finally(() => sql.end());
