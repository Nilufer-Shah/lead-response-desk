import type { LeadSource } from "@/domain/types";
import { CsvImportAdapter } from "./csv-import";
import { MetaLeadFormAdapter } from "./meta-lead-form";
import type { LeadSourceAdapter } from "./types";

const adapters = new Map<LeadSource, LeadSourceAdapter>([
  ["csv_import", new CsvImportAdapter()],
  ["meta_lead_form", new MetaLeadFormAdapter()],
]);

export function adapterFor(source: LeadSource): LeadSourceAdapter {
  const adapter = adapters.get(source);
  if (!adapter) throw new Error(`Lead source ${source} is registered but not implemented yet`);
  return adapter;
}
