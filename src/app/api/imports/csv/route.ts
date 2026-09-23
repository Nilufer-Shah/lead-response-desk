import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { withTenant } from "@/db";
import { adapterFor } from "@/lead-sources/registry";
import { readSession } from "@/lib/auth";
import { ingestLead } from "@/services/lead-intake";

export async function POST(request: Request) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role !== "owner") return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a CSV file" }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: "CSV must be smaller than 25 MB" }, { status: 413 });
  const raw = new Uint8Array(await file.arrayBuffer());
  const checksum = createHash("sha256").update(raw).digest("hex");
  const adapter = adapterFor("csv_import");
  const context = { tenantId: user.tenantId, connectionId: "44444444-4444-4444-8444-444444444442", signal: request.signal };
  const decoded = await adapter.decode({ id: checksum, tenantId: user.tenantId, source: "csv_import", receivedAt: new Date(), raw, metadata: { fileName: file.name } }, context);
  if (!decoded.ok) return NextResponse.json({ error: decoded.message }, { status: 422 });

  const result = await withTenant(user, async (transaction) => {
    const [record] = await transaction<{ id: string }[]>`
      INSERT INTO app.imports (tenant_id,file_name,checksum,status,total_rows,created_by)
      VALUES (${user.tenantId},${file.name},${checksum},'processing',${decoded.leads.length},${user.id}) RETURNING id
    `;
    let inserted = 0; let repeats = 0; let rejected = 0; let unchanged = 0;
    for (let index = 0; index < decoded.leads.length; index += 1) {
      const reference = decoded.leads[index];
      const rowNumber = Number(reference.pointer.rowNumber ?? index + 2);
      try {
        const candidate = await adapter.hydrate(reference, context);
        const outcome = await ingestLead(transaction, user.tenantId, {
          source: "csv_import", externalId: candidate.externalId, arrivedAt: candidate.sourceCreatedAt,
          fullNameRaw: candidate.person.fullNameRaw, phoneRaw: candidate.person.phoneRaw, emailRaw: candidate.person.emailRaw,
          city: candidate.person.cityRaw, campaignName: candidate.attribution?.campaignName, adName: candidate.attribution?.adName,
          customFields: candidate.customFields, eventPayload: { importId: record.id, rowNumber },
        });
        const rowStatus = outcome.action === "inserted" ? "inserted" : outcome.action === "unchanged" ? "rejected" : "repeat_enquiry";
        if (outcome.action === "inserted") inserted += 1;
        else if (outcome.action === "unchanged") unchanged += 1;
        else repeats += 1;
        await transaction`
          INSERT INTO app.import_rows (tenant_id,import_id,row_number,raw,status,lead_id,error)
          VALUES (${user.tenantId},${record.id},${rowNumber},${transaction.json(JSON.parse(JSON.stringify(candidate.rawPayload)))},${rowStatus}::app.import_row_status,${outcome.leadId},${outcome.action === "unchanged" ? "This source row was already imported" : null})
        `;
      } catch (error) {
        rejected += 1;
        await transaction`
          INSERT INTO app.import_rows (tenant_id,import_id,row_number,raw,status,error)
          VALUES (${user.tenantId},${record.id},${rowNumber},${transaction.json(JSON.parse(JSON.stringify({ pointer: reference.pointer })))},'rejected',${error instanceof Error ? error.message : "Row could not be imported"})
        `;
      }
    }
    await transaction`
      UPDATE app.imports SET status='completed',inserted_rows=${inserted},rejected_rows=${rejected + unchanged},completed_at=clock_timestamp()
      WHERE tenant_id=${user.tenantId} AND id=${record.id}
    `;
    return { importId: record.id, rows: decoded.leads.length, inserted, repeats, unchanged, rejected };
  });
  return NextResponse.json(result);
}
