import { parse } from "csv-parse/sync";
import type { CanonicalLeadCandidate, DecodeResult, LeadSourceAdapter, PersistedIngress, SourceLeadReference } from "../types";

interface CsvPointer extends Record<string, unknown> { row: Record<string, string>; rowNumber: number }

export class CsvImportAdapter implements LeadSourceAdapter<CsvPointer> {
  readonly source = "csv_import" as const;

  async decode(ingress: PersistedIngress): Promise<DecodeResult<CsvPointer>> {
    try {
      const rows = parse(Buffer.from(ingress.raw), { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Record<string, string>[];
      return {
        ok: true,
        leads: rows.map((row, index) => ({
          externalId: row.external_id || `csv:${ingress.id}:${index + 2}`,
          sourceCreatedAt: row.created_at ? new Date(row.created_at) : ingress.receivedAt,
          pointer: { row, rowNumber: index + 2 },
        })),
      };
    } catch (error) {
      return { ok: false, code: "invalid_csv", message: error instanceof Error ? error.message : "CSV could not be parsed", retryable: false };
    }
  }

  async hydrate(reference: SourceLeadReference<CsvPointer>): Promise<CanonicalLeadCandidate> {
    const { row } = reference.pointer;
    const known = new Set(["external_id", "created_at", "name", "full_name", "phone", "email", "city", "campaign", "campaign_name", "ad", "ad_name"]);
    return {
      source: this.source,
      externalId: reference.externalId,
      sourceCreatedAt: reference.sourceCreatedAt,
      person: { fullNameRaw: row.full_name || row.name, phoneRaw: row.phone, emailRaw: row.email, cityRaw: row.city },
      attribution: { campaignName: row.campaign_name || row.campaign, adName: row.ad_name || row.ad },
      customFields: Object.fromEntries(Object.entries(row).filter(([key]) => !known.has(key))),
      rawPayload: row,
    };
  }
}
