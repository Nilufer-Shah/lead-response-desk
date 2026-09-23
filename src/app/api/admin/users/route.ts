import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db";
import { normalizeEmail, normalizePhone } from "@/domain/normalization";
import { demoUsers, readSession } from "@/lib/auth";
import { env } from "@/lib/env";

const createSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  role: z.enum(["salesperson", "manager", "owner", "agency", "admin"]),
  phone: z.string().trim().optional(), email: z.string().trim().optional(),
}).superRefine((value, context) => {
  if (value.role === "salesperson" && !normalizePhone(value.phone ?? "").phoneE164) context.addIssue({ code: "custom", message: "Salespeople need a valid phone number", path: ["phone"] });
  if (value.role !== "salesperson" && !normalizeEmail(value.email)) context.addIssue({ code: "custom", message: "This role needs an email address", path: ["email"] });
});

export async function GET() {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "owner") return NextResponse.json({ error: "Owner or admin access required" }, { status: 403 });
  if (env().DEMO_MODE === "true") return NextResponse.json({ users: demoUsers.map((item) => ({ ...item, display_name: item.name, phone_e164: item.role === "salesperson" ? "+919876543210" : null, email: item.role === "salesperson" ? null : `${item.role}@example.com`, status: "active", available: true })) });
  const users = await withTenant(user, (transaction) => transaction`
    SELECT id, display_name, phone_e164, email, role, status, available, created_at FROM app.users
    WHERE tenant_id=${user.tenantId} ORDER BY status, role, display_name
  `);
  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "owner") return NextResponse.json({ error: "Owner or admin access required" }, { status: 403 });
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "User details are invalid" }, { status: 400 });
  if (env().DEMO_MODE === "true") return NextResponse.json({ ok: true, demo: true, id: crypto.randomUUID() }, { status: 201 });
  const phone = parsed.data.phone ? normalizePhone(parsed.data.phone).phoneE164 : null;
  const email = normalizeEmail(parsed.data.email);
  try {
    const [created] = await withTenant(user, async (transaction) => {
      const [store] = await transaction<{ id: string }[]>`SELECT id FROM app.stores WHERE tenant_id=${user.tenantId} AND is_default AND active LIMIT 1`;
      const inserted = await transaction<{ id: string }[]>`
        INSERT INTO app.users (tenant_id, display_name, phone_e164, email, role, status, store_id, available)
        VALUES (${user.tenantId}, ${parsed.data.displayName}, ${phone}, ${email}, ${parsed.data.role}, 'active', ${parsed.data.role === "salesperson" ? store?.id ?? null : null}, true) RETURNING id
      `;
      await transaction`INSERT INTO app.audit_log (tenant_id, actor_id, action, target_type, target_id, payload) VALUES (${user.tenantId}, ${user.id}, 'user_created', 'user', ${inserted[0].id}, ${transaction.json({ role: parsed.data.role, displayName: parsed.data.displayName })})`;
      return inserted;
    });
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch { return NextResponse.json({ error: "That phone number or email is already in use" }, { status: 409 }); }
}
