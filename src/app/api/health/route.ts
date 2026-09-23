import { NextResponse } from "next/server";
import { sqlClient } from "@/db";
import { googleCredentialsConfigured } from "@/integrations/google-sheets";
import { env } from "@/lib/env";

export async function GET() {
  let database: "healthy" | "unavailable" = "unavailable";
  try { await sqlClient()`SELECT 1`; database = "healthy"; } catch { database = "unavailable"; }
  const healthy = database !== "unavailable";
  return NextResponse.json({ status: healthy ? "ok" : "degraded", timezone: "Asia/Kolkata", database, worker: "separate-process", googleSheets: { enabled: env().GOOGLE_SHEETS_ENABLED === "true", credentialsConfigured: googleCredentialsConfigured() }, meta: { enabled: env().META_CONNECTION_ENABLED === "true", credentialsConfigured: Boolean(env().META_APP_ID && env().META_APP_SECRET && env().META_VERIFY_TOKEN && env().META_SYSTEM_USER_TOKEN) }, checkedAt: new Date().toISOString() }, { status: healthy ? 200 : 503 });
}
