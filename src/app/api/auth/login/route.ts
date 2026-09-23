import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db";
import { createSessionToken, hashSecret, SESSION_COOKIE, type SessionUser } from "@/lib/auth";
import { env } from "@/lib/env";

const schema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(200),
});

const DUMMY_HASH = "$2b$12$0.XjBodkhxsQSCQ4lMZ9De8eYKqS9nH/OK9mSFPQY4YwV48Qx9e0y";

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email and password" }, { status: 400 });
  const settings = env();
  const [account] = await withTenant({ tenantId: settings.DEFAULT_TENANT_ID, userRole: "system" }, (transaction) => transaction<{
    id: string; tenant_id: string; display_name: string; role: SessionUser["role"]; password_hash: string | null; failures: number;
  }[]>`
    SELECT u.id, u.tenant_id, u.display_name, u.role, u.password_hash,
      (SELECT count(*)::int FROM app.auth_challenges c
       WHERE c.tenant_id=u.tenant_id AND c.user_id=u.id AND c.kind='password_failure'
         AND c.created_at > clock_timestamp()-interval '15 minutes') AS failures
    FROM app.users u
    WHERE u.tenant_id=${settings.DEFAULT_TENANT_ID} AND lower(u.email)=${parsed.data.email} AND u.status='active'
    LIMIT 1
  `);
  if (account && account.failures >= 5) return NextResponse.json({ error: "Too many sign-in attempts. Try again in 15 minutes." }, { status: 429 });

  const valid = await compare(parsed.data.password, account?.password_hash ?? DUMMY_HASH);
  if (!account || !valid) {
    if (account) await withTenant({ tenantId: account.tenant_id, userRole: "system" }, (transaction) => transaction`
      INSERT INTO app.auth_challenges (tenant_id,user_id,kind,destination,secret_hash,attempts,expires_at)
      VALUES (${account.tenant_id},${account.id},'password_failure',${parsed.data.email},${hashSecret(`${Date.now()}:${parsed.data.email}`)},1,clock_timestamp()+interval '15 minutes')
    `);
    return NextResponse.json({ error: "Email or password is incorrect" }, { status: 401 });
  }

  const user: SessionUser = { id: account.id, tenantId: account.tenant_id, name: account.display_name, role: account.role };
  const sessionId = crypto.randomUUID();
  const token = await createSessionToken(user, sessionId);
  await withTenant(user, (transaction) => transaction`
    INSERT INTO app.sessions (id,tenant_id,user_id,token_hash,device,ip,expires_at)
    VALUES (
      ${sessionId},${user.tenantId},${user.id},${hashSecret(token)},
      ${request.headers.get("user-agent")?.slice(0,500) ?? null},
      ${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null},
      clock_timestamp()+interval '30 days'
    )
  `);
  const response = NextResponse.json({ ok: true, redirectTo: user.role === "salesperson" ? "/today" : "/" });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: settings.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30, path: "/",
  });
  return response;
}
