import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db";
import { readSession } from "@/lib/auth";

const schema = z.object({ leadId: z.string().uuid(), channel: z.enum(["call", "whatsapp"]) });

export async function POST(request: Request) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role === "agency") return NextResponse.json({ error: "Agency access is read-only" }, { status: 403 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Attempt details are invalid" }, { status: 400 });
  try {
    const result = await withTenant(user, async (transaction) => {
      const [lead] = await transaction<{ id: string; stage: string; first_contacted_at: Date | null }[]>`
        SELECT id,stage::text,first_contacted_at FROM app.leads
        WHERE tenant_id=${user.tenantId} AND id=${parsed.data.leadId}
        FOR UPDATE
      `;
      if (!lead) return null;
      if (["won","dead","bad"].includes(lead.stage)) return { closed: true as const };
      const [attempt] = await transaction<{ id: string; initiated_at: Date }[]>`
        INSERT INTO app.attempts (tenant_id,lead_id,user_id,channel,initiated_at,device,ip)
        VALUES (
          ${user.tenantId},${parsed.data.leadId},${user.id},${parsed.data.channel},clock_timestamp(),
          ${request.headers.get("user-agent")?.slice(0,500) ?? null},
          ${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null}
        ) RETURNING id,initiated_at
      `;
      const [updated] = await transaction<{ stage: string; first_contacted_at: Date; first_response_minutes: number }[]>`
        SELECT stage::text,first_contacted_at,first_response_minutes FROM app.leads
        WHERE tenant_id=${user.tenantId} AND id=${parsed.data.leadId}
      `;
      return { closed: false as const, attempt, firstAttempt: !lead.first_contacted_at, lead: updated };
    });
    if (!result) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    if (result.closed) return NextResponse.json({ error: "Closed leads cannot be contacted" }, { status: 409 });
    return NextResponse.json({ id: result.attempt.id, initiatedAt: result.attempt.initiated_at.toISOString(), firstAttempt: result.firstAttempt, stage: result.lead.stage, firstResponseMinutes: result.lead.first_response_minutes }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "This lead is unavailable or the attempt could not be recorded" }, { status: 409 });
  }
}
