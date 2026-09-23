import { createHash } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";
import { env } from "@/lib/env";

export const googleSheetMappingSchema = z.object({
  externalId: z.string().trim().default("external_id"),
  createdAt: z.string().trim().default("created_at"),
  fullName: z.string().trim().min(1).default("name"),
  phone: z.string().trim().default("phone"),
  email: z.string().trim().default("email"),
  city: z.string().trim().default("city"),
  campaignName: z.string().trim().default("campaign"),
  adName: z.string().trim().default("ad"),
});

export const googleSheetConnectionInputSchema = z.object({
  spreadsheet: z.string().trim().min(1),
  sheetName: z.string().trim().min(1).max(200),
  headerRow: z.coerce.number().int().min(1).max(100).default(1),
  enabled: z.boolean().default(false),
  mapping: googleSheetMappingSchema,
});

export type GoogleSheetMapping = z.infer<typeof googleSheetMappingSchema>;
export type GoogleSheetConnectionInput = z.infer<typeof googleSheetConnectionInputSchema>;

export interface GoogleSheetRow {
  rowNumber: number;
  values: Record<string, string>;
}

export function extractSpreadsheetId(input: string): string {
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const id = match?.[1] ?? input.trim();
  if (!/^[a-zA-Z0-9-_]{20,}$/.test(id)) throw new Error("Enter a valid Google Sheets URL or spreadsheet ID");
  return id;
}

export function parseSheetDate(value: string | undefined, fallback: Date): Date {
  if (!value?.trim()) return fallback;
  const cleaned = value.trim();
  const indian = cleaned.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (indian) {
    const [, day, month, year, hour = "0", minute = "0", second = "0"] = indian;
    const parsed = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:${second.padStart(2, "0")}+05:30`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export function externalIdForSheetRow(args: {
  spreadsheetId: string;
  sheetName: string;
  row: GoogleSheetRow;
  mapping: GoogleSheetMapping;
}): string {
  const supplied = args.row.values[args.mapping.externalId]?.trim();
  const identity = supplied || [
    args.row.values[args.mapping.phone]?.trim().replace(/\D/g, ""),
    args.row.values[args.mapping.email]?.trim().toLowerCase(),
    args.row.values[args.mapping.createdAt]?.trim(),
  ].filter(Boolean).join("|") || `row-${args.row.rowNumber}`;
  const digest = createHash("sha256").update(identity).digest("hex").slice(0, 24);
  return `gs:${args.spreadsheetId}:${digest}`;
}

export function rowsFromValues(values: unknown[][], headerRow: number): { headers: string[]; rows: GoogleSheetRow[] } {
  const rawHeaders = values[headerRow - 1] ?? [];
  const headers = rawHeaders.map((value, index) => String(value ?? "").trim() || `column_${index + 1}`);
  const rows = values.slice(headerRow).map((row, index) => ({
    rowNumber: headerRow + index + 1,
    values: Object.fromEntries(headers.map((header, column) => [header, String(row[column] ?? "").trim()])),
  })).filter((row) => Object.values(row.values).some(Boolean));
  return { headers, rows };
}

let cachedToken: { value: string; expiresAt: number } | undefined;

export function googleCredentialsConfigured(): boolean {
  return Boolean(env().GOOGLE_SERVICE_ACCOUNT_EMAIL && env().GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
}

async function accessToken(signal?: AbortSignal): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const email = env().GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = env().GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey) throw new Error("Google service account credentials are not configured on the server");
  const privateKey = await importPKCS8(rawKey.replace(/\\n/g, "\n"), "RS256");
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/spreadsheets.readonly" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(email).setAudience("https://oauth2.googleapis.com/token").setIssuedAt(now).setExpirationTime(now + 3600).sign(privateKey);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", signal, headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const body = await response.json() as { access_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !body.access_token) throw new Error(body.error_description ?? "Google authentication failed");
  cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

export async function readGoogleSheet(args: { spreadsheetId: string; sheetName: string; headerRow: number; signal?: AbortSignal }) {
  const token = await accessToken(args.signal);
  const escapedName = args.sheetName.replace(/'/g, "''");
  const range = `'${escapedName}'!${args.headerRow}:5000`;
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(args.spreadsheetId)}/values/${encodeURIComponent(range)}`);
  url.searchParams.set("majorDimension", "ROWS");
  url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
  url.searchParams.set("dateTimeRenderOption", "FORMATTED_STRING");
  const response = await fetch(url, { signal: args.signal, headers: { authorization: `Bearer ${token}` } });
  const body = await response.json() as { values?: unknown[][]; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Google Sheets could not be read");
  return rowsFromValues(body.values ?? [], 1);
}
