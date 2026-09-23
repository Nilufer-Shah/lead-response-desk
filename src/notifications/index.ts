import type { NotificationAdapter, NotificationMessage, NotificationResult } from "./types";
import nodemailer from "nodemailer";
import webPush from "web-push";
import { env } from "@/lib/env";

export class DisabledWhatsAppAdapter implements NotificationAdapter {
  readonly channel = "whatsapp" as const;
  async send(): Promise<NotificationResult> { return { accepted: false, detail: "WhatsApp provider is not configured" }; }
}

export class AiSensyWhatsAppAdapter implements NotificationAdapter {
  readonly channel = "whatsapp" as const;
  async send(message: NotificationMessage): Promise<NotificationResult> {
    const settings = env();
    if (!settings.AISENSY_API_KEY || !message.recipient.phoneE164) return { accepted: false, detail: "AiSensy credentials or recipient phone are missing" };
    const response = await fetch(settings.AISENSY_API_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiKey: settings.AISENSY_API_KEY,
        campaignName: message.template,
        destination: message.recipient.phoneE164.replace(/^\+/, ""),
        userName: "Roopkala Lead Desk",
        templateParams: Object.values(message.variables).map(String),
        source: "lead-response-desk",
      }),
    });
    const body = await response.text();
    return response.ok ? { accepted: true, providerId: response.headers.get("x-request-id") ?? undefined } : { accepted: false, detail: `AiSensy ${response.status}: ${body.slice(0, 300)}` };
  }
}

export class DeferredMetaCloudWhatsAppAdapter implements NotificationAdapter {
  readonly channel = "whatsapp" as const;
  async send(): Promise<NotificationResult> { return { accepted: false, detail: "Meta Cloud connection is intentionally deferred" }; }
}

export class PushAdapter implements NotificationAdapter {
  readonly channel = "push" as const;
  async send(message: NotificationMessage): Promise<NotificationResult> {
    const settings = env();
    if (!message.recipient.pushSubscription || !settings.WEB_PUSH_PUBLIC_KEY || !settings.WEB_PUSH_PRIVATE_KEY) return { accepted: false, detail: "Push subscription or VAPID keys are missing" };
    try {
      webPush.setVapidDetails(`mailto:${settings.EMAIL_FROM}`, settings.WEB_PUSH_PUBLIC_KEY, settings.WEB_PUSH_PRIVATE_KEY);
      const result = await webPush.sendNotification(message.recipient.pushSubscription as webPush.PushSubscription, JSON.stringify({ template: message.template, variables: message.variables }));
      return { accepted: result.statusCode >= 200 && result.statusCode < 300, providerId: result.headers.location };
    } catch (error) { return { accepted: false, detail: error instanceof Error ? error.message : "Push delivery failed" }; }
  }
}

export class EmailAdapter implements NotificationAdapter {
  readonly channel = "email" as const;
  async send(message: NotificationMessage): Promise<NotificationResult> {
    const settings = env();
    if (!message.recipient.email || !settings.SMTP_URL) return { accepted: false, detail: "Email address or SMTP_URL is missing" };
    try {
      const result = await nodemailer.createTransport(settings.SMTP_URL).sendMail({
        from: settings.EMAIL_FROM,
        to: message.recipient.email,
        subject: message.template.split("_").map((word) => word[0]?.toUpperCase() + word.slice(1)).join(" "),
        text: Object.entries(message.variables).map(([key, value]) => `${key}: ${value}`).join("\n"),
      });
      return { accepted: true, providerId: result.messageId };
    } catch (error) { return { accepted: false, detail: error instanceof Error ? error.message : "Email delivery failed" }; }
  }
}

export function configuredAdapters(): NotificationAdapter[] {
  const provider = env().WHATSAPP_PROVIDER;
  const whatsapp = provider === "aisensy" ? new AiSensyWhatsAppAdapter() : provider === "meta_cloud" ? new DeferredMetaCloudWhatsAppAdapter() : new DisabledWhatsAppAdapter();
  return [whatsapp, new PushAdapter(), new EmailAdapter()];
}

export async function sendWithFallback(message: NotificationMessage, adapters: NotificationAdapter[] = configuredAdapters()) {
  const attempts: Array<{ channel: string; result: NotificationResult }> = [];
  for (const adapter of adapters) {
    const result = await adapter.send(message);
    attempts.push({ channel: adapter.channel, result });
    if (result.accepted) return { deliveredBy: adapter.channel, attempts };
  }
  return { deliveredBy: null, attempts };
}
