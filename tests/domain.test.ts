import { describe, expect, it } from "vitest";
import { normalizePhone, titleCaseName } from "@/domain/normalization";
import { computeSlaDueAt, type DailyHours } from "@/domain/sla";

const hours: DailyHours[] = Array.from({ length: 7 }, (_, weekday) => ({ weekday, opensAt: "11:00", closesAt: "20:00", enabled: true }));

describe("normalization", () => {
  it("normalizes phone numbers", () => {
    expect(normalizePhone("098 7654-3210")).toEqual({ phoneE164: "+919876543210" });
    expect(normalizePhone("+44 7700 900123")).toEqual({ phoneE164: "+447700900123" });
    expect(titleCaseName("  priya SHARMA ")).toBe("Priya Sharma");
  });
});

describe("SLA", () => {
  it("moves a 21:30 domestic lead to 11:05 the next day", () => {
    const result = computeSlaDueAt({ receivedAt: new Date("2026-09-13T16:00:00.000Z"), hours });
    expect(result.toISOString()).toBe("2026-09-14T05:35:00.000Z");
  });
});
