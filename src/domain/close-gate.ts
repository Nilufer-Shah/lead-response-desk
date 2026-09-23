import type { AttemptEvidence, CloseReason, QualityFlag } from "./types";

export interface CloseGateInput {
  attempts: AttemptEvidence[];
  closeReason?: CloseReason;
  qualityFlag?: QualityFlag;
  note?: string;
  linkedLeadId?: string;
  orderValue?: number;
}

export interface GateRequirement { key: string; remaining: number; message: string }

export function evaluateCloseGate(input: CloseGateInput): { allowed: boolean; missing: GateRequirement[] } {
  const days = new Set(input.attempts.map((attempt) => attempt.initiatedAt.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })));
  const whatsapp = input.attempts.filter((attempt) => attempt.channel === "whatsapp" && attempt.whatsappSendAttempted).length;
  const noteLength = input.note?.trim().length ?? 0;
  const missing: GateRequirement[] = [];
  const fullGate = input.closeReason === "unreachable" || input.closeReason === "no_response" ||
    ["spam", "wrong_person", "budget_mismatch", "competitor"].includes(input.qualityFlag ?? "");

  if (fullGate) {
    if (input.attempts.length < 3) missing.push({ key: "attempts", remaining: 3 - input.attempts.length, message: `${3 - input.attempts.length} more attempt${3 - input.attempts.length === 1 ? "" : "s"} needed` });
    if (days.size < 2) missing.push({ key: "days", remaining: 2 - days.size, message: "Attempts are needed on 1 more day" });
    if (whatsapp < 1) missing.push({ key: "whatsapp", remaining: 1, message: "1 WhatsApp message needed" });
    if (noteLength < 15) missing.push({ key: "note", remaining: 15 - noteLength, message: `${15 - noteLength} more note characters needed` });
  }

  if (input.qualityFlag === "out_of_area" || input.closeReason === "out_of_area") {
    if (input.attempts.length < 1) missing.push({ key: "attempts", remaining: 1, message: "1 attempt needed" });
    if (!noteLength) missing.push({ key: "note", remaining: 1, message: "A note is needed" });
  }

  if (input.qualityFlag === "invalid_number" || input.closeReason === "invalid_number") {
    if (input.attempts.length < 1) missing.push({ key: "attempts", remaining: 1, message: "1 attempt needed" });
    if (!input.attempts.some((attempt) => attempt.invalidNumberEvidence)) missing.push({ key: "evidence", remaining: 1, message: "Invalid-number evidence is needed" });
  }

  if (input.closeReason === "duplicate" && !input.linkedLeadId) missing.push({ key: "linkedLead", remaining: 1, message: "Link the original lead" });
  if (input.closeReason === "bought" && !(input.orderValue && input.orderValue > 0)) missing.push({ key: "orderValue", remaining: 1, message: "Order value is needed" });

  return { allowed: missing.length === 0, missing };
}

export function remainingRequirementCopy(missing: GateRequirement[]): string {
  if (!missing.length) return "Ready to close";
  return missing.map((item) => item.message).join(" and ");
}
