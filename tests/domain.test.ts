import { describe, expect, it } from "vitest";
import { evaluateCloseGate } from "@/domain/close-gate";
import { normalizePhone, titleCaseName } from "@/domain/normalization";
import { computeSlaDueAt, type DailyHours } from "@/domain/sla";

const hours: DailyHours[] = Array.from({ length: 7 }, (_, weekday) => ({ weekday, opensAt: "11:00", closesAt: "20:00", enabled: true }));

describe("normalization", () => {
  it("normalizes Indian numbers and detects international numbers", () => {
    expect(normalizePhone("098 7654-3210")).toEqual({ phoneE164: "+919876543210", isInternational: false });
    expect(normalizePhone("+44 7700 900123")).toEqual({ phoneE164: "+447700900123", isInternational: true });
    expect(titleCaseName("  priya SHARMA ")).toBe("Priya Sharma");
  });
});

describe("SLA", () => {
  it("moves a 21:30 domestic lead to 11:05 the next day", () => {
    const result = computeSlaDueAt({ receivedAt: new Date("2026-09-13T16:00:00.000Z"), isInternational: false, hours });
    expect(result.toISOString()).toBe("2026-09-14T05:35:00.000Z");
  });

  it("uses a continuous five-minute clock for international leads", () => {
    const result = computeSlaDueAt({ receivedAt: new Date("2026-09-13T16:00:00.000Z"), isInternational: true, hours });
    expect(result.toISOString()).toBe("2026-09-13T16:05:00.000Z");
  });
});

describe("bad lead gate", () => {
  it("blocks two attempts on one day", () => {
    const result = evaluateCloseGate({
      closeReason: "unreachable",
      note: "Tried twice today, no answer",
      attempts: [
        { channel: "call", initiatedAt: new Date("2026-09-12T07:00:00Z") },
        { channel: "whatsapp", initiatedAt: new Date("2026-09-12T08:00:00Z"), whatsappSendAttempted: true },
      ],
    });
    expect(result.allowed).toBe(false);
    expect(result.missing.map((item) => item.key)).toEqual(["attempts", "days"]);
  });

  it("allows three attempts over two days including WhatsApp", () => {
    const result = evaluateCloseGate({
      closeReason: "unreachable",
      note: "Called repeatedly and sent the catalogue with no response.",
      attempts: [
        { channel: "call", initiatedAt: new Date("2026-09-12T07:00:00Z") },
        { channel: "whatsapp", initiatedAt: new Date("2026-09-12T08:00:00Z"), whatsappSendAttempted: true },
        { channel: "call", initiatedAt: new Date("2026-09-13T08:00:00Z") },
      ],
    });
    expect(result.allowed).toBe(true);
  });
});
