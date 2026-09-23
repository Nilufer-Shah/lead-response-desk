export const leadSources = [
  "meta_lead_form", "csv_import", "whatsapp", "instagram_dm", "instagram_comment",
  "instagram_story_reply", "website_form", "website_whatsapp", "walk_in",
  "phone_inbound", "referral", "other",
] as const;

export type LeadSource = (typeof leadSources)[number];
export type AttemptChannel = "call" | "whatsapp" | "sms" | "email" | "in_person";

export interface AttemptEvidence {
  channel: AttemptChannel;
  initiatedAt: Date;
  disposition?: string;
  whatsappSendAttempted?: boolean;
  invalidNumberEvidence?: boolean;
}
