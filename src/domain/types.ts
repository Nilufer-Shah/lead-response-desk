export const leadSources = [
  "meta_lead_form", "csv_import", "whatsapp", "instagram_dm", "instagram_comment",
  "instagram_story_reply", "website_form", "website_whatsapp", "walk_in",
  "phone_inbound", "referral", "other",
] as const;

export type LeadSource = (typeof leadSources)[number];
export type AttemptChannel = "call" | "whatsapp" | "sms" | "email" | "in_person";
export type QualityFlag = "unrated" | "good" | "invalid_number" | "wrong_person" | "out_of_area" | "budget_mismatch" | "competitor" | "spam" | "duplicate";
export type CloseReason = "bought" | "bought_elsewhere" | "price_too_high" | "out_of_area" | "just_browsing" | "unreachable" | "wrong_number" | "invalid_number" | "duplicate" | "spam" | "no_response";

export interface AttemptEvidence {
  channel: AttemptChannel;
  initiatedAt: Date;
  disposition?: string;
  whatsappSendAttempted?: boolean;
  invalidNumberEvidence?: boolean;
}
