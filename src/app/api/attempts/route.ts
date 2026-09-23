import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { withTenant } from "@/db";
import { env } from "@/lib/env";

const schema = z.object({ leadId: z.string().uuid(), channel: z.enum(["call", "whatsapp", "sms", "email", "in_person"]), clientInitiatedAt: z.string().datetime().nullable().optional() });

export async function POST(request: Request) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role === "agency") return NextResponse.json({ error: "Agency access is read-only" }, { status: 403 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Attempt details are invalid" }, { status: 400 });
  const initiatedAt = new Date();
  const clientTime = parsed.data.clientInitiatedAt ? new Date(parsed.data.clientInitiatedAt) : null;
  const lateSync = Boolean(clientTime && Math.abs(initiatedAt.getTime() - clientTime.getTime()) > 30 * 60_000);
  if (env().DEMO_MODE === "true") {
    return NextResponse.json({ id: crypto.randomUUID(), tenantId: user.tenantId, userId: user.id, ...parsed.data, initiatedAt: initiatedAt.toISOString(), lateSync }, { status: 201 });
  }
  try {
    const [attempt] = await withTenant(user, (transaction) => transaction<{
      id: string; initiated_at: Date; client_initiated_at: Date | null;
    }[]>`
      INSERT INTO app.attempts (tenant_id, lead_id, user_id, channel, initiated_at, client_initiated_at, device, ip)
      VALUES (
        ${user.tenantId}, ${parsed.data.leadId}, ${user.id}, ${parsed.data.channel}, clock_timestamp(), ${clientTime},
        ${request.headers.get("user-agent")?.slice(0, 500) ?? null},
        ${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null}
      )
      RETURNING id, initiated_at, client_initiated_at
    `);
    return NextResponse.json({ id: attempt.id, tenantId: user.tenantId, userId: user.id, ...parsed.data, initiatedAt: attempt.initiated_at.toISOString(), lateSync }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "This lead is unavailable or the attempt could not be recorded" }, { status: 409 });
  }
}
