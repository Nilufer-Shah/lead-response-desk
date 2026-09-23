import { NextResponse } from "next/server";
import { extractSpreadsheetId, googleCredentialsConfigured, googleSheetConnectionInputSchema, readGoogleSheet } from "@/integrations/google-sheets";
import { readSession } from "@/lib/auth";

export async function POST(request: Request) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  if (!googleCredentialsConfigured()) return NextResponse.json({ error: "Add the Google service account email and private key to the server first" }, { status: 409 });
  const parsed = googleSheetConnectionInputSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid settings" }, { status: 400 });
  try {
    const spreadsheetId = extractSpreadsheetId(parsed.data.spreadsheet);
    const sheet = await readGoogleSheet({ spreadsheetId, sheetName: parsed.data.sheetName, headerRow: parsed.data.headerRow, signal: request.signal });
    return NextResponse.json({ healthy: true, rowCount: sheet.rows.length, headers: sheet.headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Connection test failed" }, { status: 422 });
  }
}
