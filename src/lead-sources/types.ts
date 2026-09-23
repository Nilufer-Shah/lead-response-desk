import type { LeadSource } from "@/domain/types";

export type JsonObject = Readonly<Record<string, unknown>>;

export interface PersistedIngress {
  readonly id: string;
  readonly tenantId: string;
  readonly source: LeadSource;
  readonly receivedAt: Date;
  readonly raw: Uint8Array;
  readonly metadata: JsonObject;
}

export interface SourceLeadReference<TPointer> {
  readonly externalId: string;
  readonly sourceCreatedAt: Date;
  readonly pointer: Readonly<TPointer>;
}

export interface CanonicalLeadCandidate {
  readonly source: LeadSource;
  readonly externalId: string;
  readonly sourceCreatedAt: Date;
  readonly form?: { id: string; name?: string };
  readonly attribution?: {
    campaignId?: string; campaignName?: string; adsetId?: string; adsetName?: string;
    adId?: string; adName?: string; creativeThumbnailUrl?: string;
  };
  readonly person: { fullNameRaw?: string; phoneRaw?: string; emailRaw?: string; cityRaw?: string };
  readonly customFields: JsonObject;
  readonly rawPayload: JsonObject;
}

export type DecodeResult<TPointer> =
  | { readonly ok: true; readonly leads: readonly SourceLeadReference<TPointer>[] }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly retryable: boolean };

export interface AdapterContext { readonly tenantId: string; readonly connectionId: string; readonly signal: AbortSignal }
export interface ReconciliationWindow { readonly from: Date; readonly to: Date; readonly cursor?: string }

export interface LeadSourceAdapter<TPointer extends Record<string, unknown> = Record<string, unknown>> {
  readonly source: LeadSource;
  decode(ingress: PersistedIngress, context: AdapterContext): Promise<DecodeResult<TPointer>>;
  hydrate(reference: SourceLeadReference<TPointer>, context: AdapterContext): Promise<CanonicalLeadCandidate>;
  reconcile?(window: ReconciliationWindow, context: AdapterContext): AsyncIterable<SourceLeadReference<TPointer>>;
  healthCheck?(context: AdapterContext): Promise<{ healthy: boolean; checkedAt: Date; detail?: string }>;
}
