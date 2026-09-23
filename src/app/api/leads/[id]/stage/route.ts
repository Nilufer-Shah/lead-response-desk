import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db";
import { readSession } from "@/lib/auth";

const schema = z.object({ stage: z.enum(["new", "contacted", "follow_up", "dormant"]) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json());
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Stage details are invalid" }, { status: 400 });
  const updated = await withTenant(user, async (transaction) => {
    const rows = await transaction<{ id: string }[]>`
      UPDATE app.leads SET stage=${parsed.data.stage}::app.lead_stage
      WHERE tenant_id=${user.tenantId} AND id=${id} AND stage NOT IN ('won','dead','bad') RETURNING id
    `;
    return rows.length > 0;
  });
  return updated ? NextResponse.json({ ok: true, stage: parsed.data.stage }) : NextResponse.json({ error: "Lead not found or already closed" }, { status: 404 });
}
