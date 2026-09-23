import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db";
import { normalizeEmail, normalizePhone } from "@/domain/normalization";
import { readSession } from "@/lib/auth";

const createSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  phone: z.string().trim().optional(),
  role: z.enum(["owner", "salesperson", "agency"]),
  temporaryPassword: z.string().min(10).max(200),
});

export async function GET() {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  const users = await withTenant(user, (transaction) => transaction`
    SELECT id,display_name,phone_e164,email,role,status,available,password_reset_required,created_at
    FROM app.users WHERE tenant_id=${user.tenantId} ORDER BY status,role,display_name
  `);
  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "User details are invalid" }, { status: 400 });
  const email = normalizeEmail(parsed.data.email);
  const phone = parsed.data.phone ? normalizePhone(parsed.data.phone).phoneE164 : null;
  const passwordHash = await hash(parsed.data.temporaryPassword, 12);
  try {
    const [created] = await withTenant(user, async (transaction) => {
      const [store] = await transaction<{ id: string }[]>`SELECT id FROM app.stores WHERE tenant_id=${user.tenantId} AND is_default AND active LIMIT 1`;
      const rows = await transaction<{ id: string }[]>`
        INSERT INTO app.users (tenant_id,display_name,phone_e164,email,role,status,store_id,available,password_hash,password_reset_required)
        VALUES (${user.tenantId},${parsed.data.displayName},${phone},${email},${parsed.data.role},'active',${parsed.data.role === "salesperson" ? store?.id ?? null : null},true,${passwordHash},true)
        RETURNING id
      `;
      await transaction`INSERT INTO app.audit_log (tenant_id,actor_id,action,target_type,target_id,payload) VALUES (${user.tenantId},${user.id},'user_created','user',${rows[0].id},${transaction.json({ role: parsed.data.role, displayName: parsed.data.displayName })})`;
      return rows;
    });
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "That email or phone number is already in use" }, { status: 409 });
  }
}
