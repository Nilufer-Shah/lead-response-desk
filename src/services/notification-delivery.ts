import { withTenant } from "@/db";
import { sendWithFallback } from "@/notifications";

export async function deliverQueuedNotifications(tenantId: string) {
  return withTenant({ tenantId, userRole: "system" }, async (transaction) => {
    const queued = await transaction<{
      id: string; lead_id: string | null; recipient_user_id: string; template: string; deduplication_key: string;
      payload: Record<string, unknown>; phone_e164: string | null; email: string | null;
    }[]>`
      SELECT n.id, n.lead_id, n.recipient_user_id, n.template, n.deduplication_key, n.payload, u.phone_e164, u.email
      FROM app.notifications n JOIN app.users u ON u.tenant_id = n.tenant_id AND u.id = n.recipient_user_id
      WHERE n.tenant_id = ${tenantId} AND n.status = 'queued'
      ORDER BY n.created_at LIMIT 25 FOR UPDATE OF n SKIP LOCKED
    `;
    let delivered = 0;
    for (const notification of queued) {
      const variables = Object.fromEntries(Object.entries(notification.payload).filter((entry): entry is [string, string | number] => typeof entry[1] === "string" || typeof entry[1] === "number"));
      const result = await sendWithFallback({
        tenantId,
        recipient: { userId: notification.recipient_user_id, phoneE164: notification.phone_e164 ?? undefined, email: notification.email ?? undefined },
        template: notification.template,
        variables,
        deduplicationKey: notification.deduplication_key,
      });
      const accepted = result.deliveredBy !== null;
      await transaction`
        UPDATE app.notifications
        SET status = ${accepted ? "sent" : "failed"}, channel = COALESCE(${result.deliveredBy}, channel),
          provider_response = ${JSON.stringify(result)}::jsonb,
          sent_at = CASE WHEN ${accepted} THEN clock_timestamp() ELSE sent_at END,
          failed_at = CASE WHEN ${accepted} THEN failed_at ELSE clock_timestamp() END
        WHERE tenant_id = ${tenantId} AND id = ${notification.id}
      `;
      if (accepted) delivered += 1;
    }
    return { processed: queued.length, delivered };
  });
}
