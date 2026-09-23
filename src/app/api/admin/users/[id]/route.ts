import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db";
import { readSession } from "@/lib/auth";

const schema = z.object({
  status: z.enum(["active", "disabled"]).optional(),
  role: z.enum(["owner", "salesperson", "agency"]).optional(),
  temporaryPassword: z.string().min(10).max(200).optional(),
}).refine((value) => value.status !== undefined || value.role !== undefined || value.temporaryPassword !== undefined);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json());
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Update is invalid" }, { status: 400 });
  if (id === user.id && (parsed.data.status === "disabled" || (parsed.data.role && parsed.data.role !== "owner"))) return NextResponse.json({ error: "You cannot remove your own owner access" }, { status: 422 });
  const passwordHash = parsed.data.temporaryPassword ? await hash(parsed.data.temporaryPassword, 12) : null;
  const [updated] = await withTenant(user, async (transaction) => {
    const rows = await transaction<{ id: string }[]>`
      UPDATE app.users SET
        status=COALESCE(${parsed.data.status ?? null}::app.user_status,status),
        role=COALESCE(${parsed.data.role ?? null}::app.user_role,role),
        password_hash=COALESCE(${passwordHash},password_hash),
        password_reset_required=CASE WHEN ${passwordHash}::text IS NULL THEN password_reset_required ELSE true END
      WHERE tenant_id=${user.tenantId} AND id=${id}
      RETURNING id
    `;
    if (rows[0] && (parsed.data.status === "disabled" || passwordHash)) await transaction`
      UPDATE app.sessions SET revoked_at=clock_timestamp()
      WHERE tenant_id=${user.tenantId} AND user_id=${id} AND revoked_at IS NULL
    `;
    if (rows[0]) await transaction`INSERT INTO app.audit_log (tenant_id,actor_id,action,target_type,target_id,payload) VALUES (${user.tenantId},${user.id},'user_updated','user',${id},${transaction.json({ status: parsed.data.status, role: parsed.data.role, passwordReset: Boolean(passwordHash) })})`;
    return rows;
  });
  return updated ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "User not found" }, { status: 404 });
}
