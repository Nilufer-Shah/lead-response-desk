import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { testMetaConnection } from "@/services/meta-leads";

export async function POST(request: Request) {
  const user = await readSession(); if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  if (!env().META_SYSTEM_USER_TOKEN) return NextResponse.json({ error: "META_SYSTEM_USER_TOKEN is not configured on the server" }, { status: 409 });
  try { return NextResponse.json(await testMetaConnection(user.tenantId, request.signal)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Meta connection failed" }, { status: 422 }); }
}
