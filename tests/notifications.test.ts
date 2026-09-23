import { describe, expect, it } from "vitest";
import { sendWithFallback } from "@/notifications";
import type { NotificationAdapter } from "@/notifications/types";

describe("notification fallback", () => {
  it("falls back from WhatsApp to push", async () => {
    const adapters: NotificationAdapter[] = [
      { channel: "whatsapp", send: async () => ({ accepted: false, detail: "down" }) },
      { channel: "push", send: async () => ({ accepted: true, providerId: "push-1" }) },
      { channel: "email", send: async () => ({ accepted: true, providerId: "email-1" }) },
    ];
    const result = await sendWithFallback({ tenantId: "t", recipient: { userId: "u" }, template: "sla_breach", variables: {}, deduplicationKey: "d" }, adapters);
    expect(result.deliveredBy).toBe("push");
    expect(result.attempts).toHaveLength(2);
  });
});
