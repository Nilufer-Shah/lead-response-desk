import { NextResponse } from "next/server";
import { z } from "zod";
import { demoUsers, hashSecret, newOpaqueToken, newOtp, type SessionUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { withTenant } from "@/db";
import { normalizePhone } from "@/domain/normalization";
import { deliverAuthChallenge } from "@/lib/auth-delivery";

const requestSchema = z.object({ role: z.enum(["salesperson", "owner", "agency", "admin"]).optional(), identifier: z.string().trim().min(3).max(320).optional() });

function mask(value: string) {
  if (value.includes("@")) { const [name, domain] = value.split("@"); return `${name.slice(0, 1)}••••@${domain}`; }
  return `${value.slice(0, 3)} •••••• ${value.slice(-4)}`;
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid phone number or email address" }, { status: 400 });
  const settings = env();
  if (settings.DEMO_MODE === "true") {
    const user = demoUsers.find((candidate) => candidate.role === parsed.data.role);
    if (!user) return NextResponse.json({ error: "Choose a valid access role" }, { status: 400 });
    const code = "123456";
    return NextResponse.json({ challengeId: user.id, kind: "phone_otp", destination: parsed.data.role === "salesperson" ? "+91 •••••• 3210" : "h••••@example.com", ...(settings.OTP_DELIVERY_MODE === "console" ? { developmentCode: code } : {}) });
  }
  if (!parsed.data.identifier) return NextResponse.json({ error: "Enter your phone number or email address" }, { status: 400 });
  const identifier = parsed.data.identifier;
  const email = identifier.includes("@") ? identifier.toLowerCase() : null;
  const phone = email ? null : normalizePhone(identifier).phoneE164;
  const [account] = await withTenant({ tenantId: settings.DEFAULT_TENANT_ID, userRole: "system" }, (transaction) => transaction<{
    id: string; tenant_id: string; display_name: string; role: SessionUser["role"]; phone_e164: string | null; email: string | null;
  }[]>`
    SELECT id, tenant_id, display_name, role, phone_e164, email
    FROM app.users
    WHERE tenant_id = ${settings.DEFAULT_TENANT_ID} AND status = 'active'
      AND ((${email}::text IS NOT NULL AND lower(email) = ${email}) OR (${phone}::text IS NOT NULL AND phone_e164 = ${phone}))
    LIMIT 1
  `);
  if (!account) return NextResponse.json({ error: "No active account matches that sign-in address" }, { status: 404 });
  const kind = account.role === "salesperson" ? "phone_otp" as const : "magic_link" as const;
  const destination = kind === "phone_otp" ? account.phone_e164 : account.email;
  if (!destination) return NextResponse.json({ error: "This account does not have the required sign-in address" }, { status: 409 });
  const secret = kind === "phone_otp" ? newOtp() : newOpaqueToken();
  const challengeId = crypto.randomUUID();
  const accepted = await withTenant({ tenantId: account.tenant_id, userRole: "system" }, async (transaction) => {
    const [rate] = await transaction<{ total: number }[]>`SELECT count(*)::int AS total FROM app.auth_challenges WHERE tenant_id=${account.tenant_id} AND user_id=${account.id} AND created_at > clock_timestamp()-interval '15 minutes'`;
    if (rate.total >= 5) return false;
    await transaction`
      INSERT INTO app.auth_challenges (id, tenant_id, user_id, kind, destination, secret_hash, expires_at)
      VALUES (${challengeId}, ${account.tenant_id}, ${account.id}, ${kind}, ${destination}, ${hashSecret(secret)}, clock_timestamp() + interval '15 minutes')
    `;
    return true;
  });
  if (!accepted) return NextResponse.json({ error: "Too many sign-in requests. Try again in 15 minutes." }, { status: 429 });
  try { await deliverAuthChallenge({ kind, destination, secret, challengeId }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "The sign-in message could not be sent" }, { status: 503 }); }
  return NextResponse.json({ challengeId, kind, destination: mask(destination), ...(settings.OTP_DELIVERY_MODE === "console" ? kind === "phone_otp" ? { developmentCode: secret } : { developmentLink: `${settings.APP_URL}/login?challengeId=${challengeId}&token=${secret}` } : {}) });
}
