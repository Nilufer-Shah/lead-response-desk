import { NextResponse } from "next/server";
import { queueDailyOwnerDigest } from "@/services/digest";
import { readSession } from "@/lib/auth";
import { env } from "@/lib/env";

export async function POST() {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!(["owner", "manager", "admin"] as string[]).includes(user.role)) return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  if (env().DEMO_MODE === "true") return NextResponse.json({ ok: true, queued: 1 });
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const queued = await queueDailyOwnerDigest(user.tenantId, date);
  return NextResponse.json({ ok: true, queued });
}
