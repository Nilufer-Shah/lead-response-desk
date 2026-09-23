import { hash } from "bcryptjs";
import postgres from "postgres";
import { env } from "../src/lib/env";

const settings = env();
const sql = postgres(settings.DATABASE_URL, { max: 1, prepare: false });

async function main() {
  const email = settings.BOOTSTRAP_OWNER_EMAIL?.toLowerCase();
  const password = settings.OWNER_RESET_PASSWORD ?? settings.BOOTSTRAP_OWNER_PASSWORD;
  if (!email || !password) throw new Error("Set BOOTSTRAP_OWNER_EMAIL and OWNER_RESET_PASSWORD before running this command");
  const passwordHash = await hash(password, 12);
  await sql.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${settings.DEFAULT_TENANT_ID}, true)`;
    await transaction`SELECT set_config('app.user_role', 'system', true)`;
    const [owner] = await transaction<{ id: string }[]>`
      UPDATE app.users SET password_hash=${passwordHash}, password_reset_required=false, status='active'
      WHERE tenant_id=${settings.DEFAULT_TENANT_ID} AND lower(email)=${email} AND role='owner'
      RETURNING id
    `;
    if (!owner) throw new Error(`No owner account found for ${email}`);
    await transaction`UPDATE app.sessions SET revoked_at=clock_timestamp() WHERE tenant_id=${settings.DEFAULT_TENANT_ID} AND user_id=${owner.id} AND revoked_at IS NULL`;
    await transaction`INSERT INTO app.audit_log (tenant_id,actor_id,action,target_type,target_id,payload) VALUES (${settings.DEFAULT_TENANT_ID},NULL,'owner_password_reset','user',${owner.id},${transaction.json({ email })})`;
  });
  process.stdout.write(`Owner password reset: ${email}\n`);
}

main().finally(() => sql.end());
