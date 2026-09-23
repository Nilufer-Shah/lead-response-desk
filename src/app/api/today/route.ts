import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { getTodayQueue } from "@/services/product-read-models";

export async function GET() {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role === "agency") return NextResponse.json({ error: "Agency access is read-only" }, { status: 403 });
  return NextResponse.json(await getTodayQueue(user));
}
