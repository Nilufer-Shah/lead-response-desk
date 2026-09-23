import { NextResponse } from "next/server";
import { sqlClient } from "@/db";
import { googleCredentialsConfigured } from "@/integrations/google-sheets";
import { env } from "@/lib/env";

export async function GET() {
  let database: "demo" | "healthy" | "unavailable" = env().DEMO_MODE === "true" ? "demo" : "unavailable";
  if (env().DEMO_MODE === "false") {
    try { await sqlClient()`SELECT 1`; database = "healthy"; } catch { database = "unavailable"; }
  }
  const healthy = database !== "unavailable";
  return NextResponse.json({ status: healthy ? "ok" : "degraded", timezone: "Asia/Kolkata", database, worker: "separate-process", googleSheets: { enabled: env().GOOGLE_SHEETS_ENABLED === "true", credentialsConfigured: googleCredentialsConfigured() }, meta: "deferred", checkedAt: new Date().toISOString() }, { status: healthy ? 200 : 503 });
}
