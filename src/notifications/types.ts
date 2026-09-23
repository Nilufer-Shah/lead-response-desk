export interface NotificationMessage {
  tenantId: string;
  recipient: { userId: string; phoneE164?: string; email?: string; pushSubscription?: unknown };
  template: string;
  variables: Record<string, string | number>;
  deduplicationKey: string;
}

export interface NotificationResult { providerId?: string; accepted: boolean; detail?: string }
export interface NotificationAdapter { readonly channel: "whatsapp" | "push" | "email"; send(message: NotificationMessage): Promise<NotificationResult> }
