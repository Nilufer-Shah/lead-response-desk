import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db";
import { readSession } from "@/lib/auth";
import { env } from "@/lib/env";

const schema = z.object({ status: z.enum(["active", "disabled"]).optional(), available: z.boolean().optional() }).refine((value) => value.status !== undefined || value.available !== undefined);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "owner") return NextResponse.json({ error: "Owner or admin access required" }, { status: 403 });
  const { id } = await context.params; const parsed = schema.safeParse(await request.json());
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Update is invalid" }, { status: 400 });
  if (id === user.id && parsed.data.status === "disabled") return NextResponse.json({ error: "You cannot disable your own account" }, { status: 422 });
  if (env().DEMO_MODE === "true") return NextResponse.json({ ok: true });
  const [updated] = await withTenant(user, (transaction) => transaction<{ id: string }[]>`
    UPDATE app.users SET status=COALESCE(${parsed.data.status ?? null}::app.user_status,status), available=COALESCE(${parsed.data.available ?? null},available)
    WHERE tenant_id=${user.tenantId} AND id=${id} RETURNING id
  `);
  return updated ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "User not found" }, { status: 404 });
}
