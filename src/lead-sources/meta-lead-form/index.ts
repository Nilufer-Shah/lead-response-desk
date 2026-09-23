import type { CanonicalLeadCandidate, DecodeResult, LeadSourceAdapter, SourceLeadReference } from "../types";

interface MetaPointer extends Record<string, unknown> { leadgenId: string; pageId: string; formId: string; adId?: string }

export class MetaConnectionDeferredError extends Error {
  constructor() { super("Meta connection is intentionally deferred until the rest of the system is approved."); }
}

export class MetaLeadFormAdapter implements LeadSourceAdapter<MetaPointer> {
  readonly source = "meta_lead_form" as const;

  async decode(): Promise<DecodeResult<MetaPointer>> {
    throw new MetaConnectionDeferredError();
  }

  async hydrate(): Promise<CanonicalLeadCandidate> {
    throw new MetaConnectionDeferredError();
  }

  async *reconcile(): AsyncIterable<SourceLeadReference<MetaPointer>> {
    throw new MetaConnectionDeferredError();
  }

  async healthCheck() {
    return { healthy: false, checkedAt: new Date(), detail: "Connection deferred" };
  }
}
