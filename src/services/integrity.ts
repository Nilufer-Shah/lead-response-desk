import { withTenant } from "@/db";

export async function runIntegrityAudit(tenantId: string) {
  const result = await withTenant({ tenantId, userRole: "system" }, async (transaction) => {
    await transaction`SELECT app.assert_tenant_security()`;
    const [counts] = await transaction<{ orphan_attempts: number; orphan_events: number; policyless_leads: number; first_touch_mismatches: number }[]>`
      SELECT
        (SELECT count(*)::integer FROM app.attempts a LEFT JOIN app.leads l ON l.tenant_id = a.tenant_id AND l.id = a.lead_id WHERE a.tenant_id = ${tenantId} AND l.id IS NULL) AS orphan_attempts,
        (SELECT count(*)::integer FROM app.attempt_events e LEFT JOIN app.attempts a ON a.tenant_id = e.tenant_id AND a.id = e.attempt_id WHERE e.tenant_id = ${tenantId} AND a.id IS NULL) AS orphan_events,
        (SELECT count(*)::integer FROM app.leads l LEFT JOIN app.sla_policies p ON p.tenant_id = l.tenant_id AND p.id = l.sla_policy_version_id WHERE l.tenant_id = ${tenantId} AND p.id IS NULL) AS policyless_leads,
        (SELECT count(*)::integer
          FROM app.leads l
          LEFT JOIN LATERAL (SELECT min(a.initiated_at) AS derived FROM app.attempts a WHERE a.tenant_id = l.tenant_id AND a.lead_id = l.id) first_attempt ON true
          WHERE l.tenant_id = ${tenantId} AND l.first_touch_at IS DISTINCT FROM first_attempt.derived
        ) AS first_touch_mismatches
    `;
    const healthy = counts.orphan_attempts === 0 && counts.orphan_events === 0 && counts.policyless_leads === 0 && counts.first_touch_mismatches === 0;
    await transaction`
      INSERT INTO app.audit_log (tenant_id, action, target_type, payload)
      VALUES (${tenantId}, 'integrity_audit', 'tenant', ${JSON.stringify({ healthy, ...counts })}::jsonb)
    `;
    return { healthy, counts };
  });
  if (!result.healthy) throw new Error(`Integrity audit failed: ${JSON.stringify(result.counts)}`);
  return result.counts;
}
