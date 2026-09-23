import { hash } from "bcryptjs";
import postgres from "postgres";
import { env } from "../src/lib/env";

const settings = env();
const sql = postgres(settings.DATABASE_URL, { max: 1, prepare: false });

async function main() {
  if (!settings.BOOTSTRAP_OWNER_EMAIL || !settings.BOOTSTRAP_OWNER_PASSWORD) {
    if (settings.NODE_ENV === "production") throw new Error("BOOTSTRAP_OWNER_EMAIL and BOOTSTRAP_OWNER_PASSWORD are required for a fresh production deployment");
    process.stdout.write("Owner bootstrap skipped: credentials are not set\n");
    return;
  }
  const email = settings.BOOTSTRAP_OWNER_EMAIL.toLowerCase();
  const passwordHash = await hash(settings.BOOTSTRAP_OWNER_PASSWORD, 12);
  await sql.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${settings.DEFAULT_TENANT_ID}, true)`;
    await transaction`SELECT set_config('app.user_role', 'system', true)`;
    const [owner] = await transaction<{ id: string }[]>`
      INSERT INTO app.users (tenant_id,display_name,email,role,status,available,password_hash,password_reset_required)
      VALUES (${settings.DEFAULT_TENANT_ID},${settings.BOOTSTRAP_OWNER_NAME},${email},'owner','active',true,${passwordHash},false)
      ON CONFLICT (tenant_id,email) DO UPDATE SET
        display_name=excluded.display_name, role='owner', status='active', password_hash=excluded.password_hash
      RETURNING id
    `;
    await transaction`
      INSERT INTO app.audit_log (tenant_id,actor_id,action,target_type,target_id,payload)
      SELECT ${settings.DEFAULT_TENANT_ID},NULL,'bootstrap_owner_ready','user',${owner.id},${transaction.json({ email })}
      WHERE NOT EXISTS (
        SELECT 1 FROM app.audit_log WHERE tenant_id=${settings.DEFAULT_TENANT_ID}
          AND action='bootstrap_owner_ready' AND target_id=${owner.id}
      )
    `;
  });
  process.stdout.write(`Bootstrap owner ready: ${email}\n`);
}

main().finally(() => sql.end());
