import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db";
import { readSession } from "@/lib/auth";

const schema = z.object({ body: z.string().trim().min(1).max(5000), clientInitiatedAt: z.string().datetime().nullable().optional() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role === "agency") return NextResponse.json({ error: "Agency access is read-only" }, { status: 403 });
  const { id: leadId } = await context.params;
  if (!z.string().uuid().safeParse(leadId).success) return NextResponse.json({ error: "Lead ID is invalid" }, { status: 400 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Note is invalid" }, { status: 400 });
  const clientTime = parsed.data.clientInitiatedAt ? new Date(parsed.data.clientInitiatedAt) : null;
  const [note] = await withTenant(user, (transaction) => transaction<{ id: string; created_at: Date }[]>`
    INSERT INTO app.notes (tenant_id, lead_id, user_id, body, client_initiated_at, device, ip)
    VALUES (
      ${user.tenantId}, ${leadId}, ${user.id}, ${parsed.data.body}, ${clientTime},
      ${request.headers.get("user-agent")?.slice(0, 500) ?? null}, ${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null}
    )
    RETURNING id, created_at
  `);
  return NextResponse.json({ id: note.id, createdAt: note.created_at.toISOString() }, { status: 201 });
}
