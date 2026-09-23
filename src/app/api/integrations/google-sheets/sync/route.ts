import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { syncGoogleSheetConnection } from "@/services/google-sheets-sync";

export async function POST(request: Request) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  try { return NextResponse.json(await syncGoogleSheetConnection(user.tenantId, undefined, request.signal)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Sync failed" }, { status: 422 }); }
}
