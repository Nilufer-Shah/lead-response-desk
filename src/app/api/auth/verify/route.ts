import { NextResponse } from "next/server";
import { z } from "zod";
import { createSessionToken, demoUsers, hashSecret, safeEqual, SESSION_COOKIE, type SessionUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { withTenant } from "@/db";

const verifySchema = z.object({ challengeId: z.string().uuid(), code: z.string().min(6).max(256) });

export async function POST(request: Request) {
  const parsed = verifySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter the six-digit code" }, { status: 400 });
  const settings = env();
  let user: SessionUser | undefined;
  let sessionId: string | undefined;
  if (settings.DEMO_MODE === "true") {
    user = demoUsers.find((candidate) => candidate.id === parsed.data.challengeId);
    if (!user || parsed.data.code !== "123456") return NextResponse.json({ error: "This sign-in code is invalid or expired" }, { status: 401 });
  } else {
    const result = await withTenant({ tenantId: settings.DEFAULT_TENANT_ID, userRole: "system" }, async (transaction) => {
      const [challenge] = await transaction<{
        id: string; tenant_id: string; user_id: string; secret_hash: string; attempts: number; display_name: string; role: SessionUser["role"];
      }[]>`
        SELECT c.id, c.tenant_id, c.user_id, c.secret_hash, c.attempts, u.display_name, u.role
        FROM app.auth_challenges c
        JOIN app.users u ON u.tenant_id = c.tenant_id AND u.id = c.user_id
        WHERE c.tenant_id = ${settings.DEFAULT_TENANT_ID} AND c.id = ${parsed.data.challengeId}
          AND c.consumed_at IS NULL AND c.expires_at > clock_timestamp() AND c.attempts < 5 AND u.status = 'active'
        FOR UPDATE
      `;
      if (!challenge) return null;
      if (!safeEqual(challenge.secret_hash, hashSecret(parsed.data.code))) {
        await transaction`UPDATE app.auth_challenges SET attempts = attempts + 1 WHERE tenant_id = ${challenge.tenant_id} AND id = ${challenge.id}`;
        return null;
      }
      await transaction`UPDATE app.auth_challenges SET consumed_at = clock_timestamp() WHERE tenant_id = ${challenge.tenant_id} AND id = ${challenge.id}`;
      return challenge;
    });
    if (!result) return NextResponse.json({ error: "This sign-in request is invalid or expired" }, { status: 401 });
    user = { id: result.user_id, tenantId: result.tenant_id, name: result.display_name, role: result.role };
    sessionId = crypto.randomUUID();
  }
  const token = await createSessionToken(user, sessionId);
  if (settings.DEMO_MODE === "false" && sessionId) {
    await withTenant({ ...user, userRole: user.role, userId: user.id }, (transaction) => transaction`
      INSERT INTO app.sessions (id, tenant_id, user_id, token_hash, device, ip, expires_at)
      VALUES (
        ${sessionId}, ${user.tenantId}, ${user.id}, ${hashSecret(token)},
        ${request.headers.get("user-agent")?.slice(0, 500) ?? null}, ${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null},
        clock_timestamp() + interval '30 days'
      )
    `);
  }
  const redirectTo = user.role === "salesperson" ? "/today" : user.role === "admin" ? "/admin" : user.role === "agency" ? "/campaigns" : "/";
  const response = NextResponse.json({ ok: true, user, redirectTo });
  response.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30, path: "/" });
  return response;
}
