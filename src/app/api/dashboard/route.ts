import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { getProductDashboard, type DashboardPeriod } from "@/services/product-read-models";

export async function GET(request: Request) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const value = new URL(request.url).searchParams.get("period") ?? "today";
  const period: DashboardPeriod = value === "7" || value === "30" ? value : "today";
  return NextResponse.json(await getProductDashboard(user, period));
}
