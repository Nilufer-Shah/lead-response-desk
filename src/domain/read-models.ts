export interface LeadCard {
  id: string; name: string; phone: string; city: string; ad: string; campaign: string;
  owner: string; state: "breach" | "warn" | "calm"; timer: number; followup: string;
  stage: string; attempts: number; connected: boolean; quality: string;
  firstResponseSeconds?: number | null; isInternational?: boolean; customFields?: Record<string, unknown>; receivedAt?: string;
}

export interface TimelineItem {
  id?: string; at: string; title: string; detail: string; tone: "calm" | "neutral" | "breach";
  corrected?: boolean; clientAt?: string | null;
}

export interface QualityCase {
  id: string; name: string; flag: string; attempts: string; days: string; whatsapp: string;
  note: string; status: "Gate failed" | "Ready for review" | "Approved" | "Returned";
}
