import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db";
import { env } from "@/lib/env";
import { readSession } from "@/lib/auth";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role === "salesperson") return NextResponse.json({ error: "Report access is not available for this role" }, { status: 403 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Report ID is invalid" }, { status: 400 });
  const [report] = await withTenant(user, (transaction) => transaction<{ storage_path: string | null; period_start: string; period_end: string }[]>`
    SELECT storage_path, period_start::text, period_end::text FROM app.reports
    WHERE tenant_id = ${user.tenantId} AND id = ${id} AND status = 'generated'
  `);
  if (!report?.storage_path) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  const root = resolve(env().REPORTS_DIR);
  const path = resolve(report.storage_path);
  if (!path.startsWith(`${root}${sep}`)) return NextResponse.json({ error: "Report path is invalid" }, { status: 500 });
  try {
    const pdf = await readFile(path);
    return new NextResponse(pdf, { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="lead-report-${report.period_start}-to-${report.period_end}.pdf"`, "cache-control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Report file is unavailable" }, { status: 404 }); }
}
