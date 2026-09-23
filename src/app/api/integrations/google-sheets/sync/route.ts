import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { syncGoogleSheetConnection } from "@/services/google-sheets-sync";

export async function POST(request: Request) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role !== "owner" && user.role !== "admin") return NextResponse.json({ error: "Owner or admin access required" }, { status: 403 });
  if (env().DEMO_MODE === "true") return NextResponse.json({ error: "Switch off demo mode and connect the production database before syncing" }, { status: 409 });
  try { return NextResponse.json(await syncGoogleSheetConnection(user.tenantId, undefined, request.signal)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Sync failed" }, { status: 422 }); }
}
