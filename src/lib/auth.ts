import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { env } from "./env";
import { withTenant } from "@/db";

export const SESSION_COOKIE = "lead_desk_session";
const secret = () => new TextEncoder().encode(env().SESSION_SECRET);

export interface SessionUser { id: string; tenantId: string; name: string; role: "salesperson" | "manager" | "owner" | "agency" | "admin" }

export const demoUsers: SessionUser[] = [
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", tenantId: "11111111-1111-4111-8111-111111111111", name: "Ashwini", role: "salesperson" },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", tenantId: "11111111-1111-4111-8111-111111111111", name: "Harsh Shah", role: "owner" },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", tenantId: "11111111-1111-4111-8111-111111111111", name: "Waqar", role: "agency" },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4", tenantId: "11111111-1111-4111-8111-111111111111", name: "Admin", role: "admin" },
];

export function hashSecret(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export function newOtp(): string { return String(Math.floor(100000 + Math.random() * 900000)); }
export function newOpaqueToken(): string { return randomBytes(32).toString("base64url"); }
export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createSessionToken(user: SessionUser, sessionId?: string): Promise<string> {
  return new SignJWT({ tenantId: user.tenantId, name: user.name, role: user.role, sessionId })
    .setProtectedHeader({ alg: "HS256" }).setSubject(user.id).setIssuedAt().setExpirationTime("30d").sign(secret());
}

export async function readSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub || !payload.tenantId || !payload.name || !payload.role) return null;
    const tokenUser = { id: payload.sub, tenantId: String(payload.tenantId), name: String(payload.name), role: payload.role as SessionUser["role"] };
    if (env().DEMO_MODE === "true") return tokenUser;
    if (!payload.sessionId) return null;
    const [active] = await withTenant({ ...tokenUser, userRole: tokenUser.role, userId: tokenUser.id }, (transaction) => transaction<{ id: string; display_name: string; role: SessionUser["role"] }[]>`
      SELECT s.id, u.display_name, u.role
      FROM app.sessions s
      JOIN app.users u ON u.tenant_id = s.tenant_id AND u.id = s.user_id
      WHERE s.tenant_id = ${tokenUser.tenantId}
        AND s.id = ${String(payload.sessionId)}
        AND s.user_id = ${tokenUser.id}
        AND s.token_hash = ${hashSecret(token)}
        AND s.revoked_at IS NULL
        AND s.expires_at > clock_timestamp()
        AND u.status = 'active'
    `);
    return active ? { ...tokenUser, name: active.display_name, role: active.role } : null;
  } catch { return null; }
}

export async function revokeCurrentSession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || env().DEMO_MODE === "true") return;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub || !payload.tenantId || !payload.sessionId) return;
    const tenantId = String(payload.tenantId); const userId = payload.sub; const sessionId = String(payload.sessionId);
    await withTenant({ tenantId, userId, userRole: String(payload.role ?? "system") }, (transaction) => transaction`
      UPDATE app.sessions SET revoked_at=clock_timestamp() WHERE tenant_id=${tenantId} AND id=${sessionId} AND user_id=${userId}
    `);
  } catch { return; }
}
