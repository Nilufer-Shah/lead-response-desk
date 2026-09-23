import { randomUUID } from "node:crypto";
import postgres from "postgres";

export const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 5 });

export interface Fixture {
  tenantId: string;
  storeId: string;
  policyId: string;
  ownerId: string;
  salespersonA: string;
  salespersonB: string;
  disabledSalesperson: string;
}

export async function createFixture(): Promise<Fixture> {
  const fixture: Fixture = {
    tenantId: randomUUID(), storeId: randomUUID(), policyId: randomUUID(), ownerId: randomUUID(),
    salespersonA: randomUUID(), salespersonB: randomUUID(), disabledSalesperson: randomUUID(),
  };
  await sql`
    INSERT INTO app.tenants (tenant_id,client_name,slug,followup_days)
    VALUES (${fixture.tenantId},'Test Lead Desk',${`test-${fixture.tenantId}`},4)
  `;
  await sql`
    INSERT INTO app.stores (id,tenant_id,name,slug,is_default,active)
    VALUES (${fixture.storeId},${fixture.tenantId},'Main store','main',true,true)
  `;
  for (let weekday = 0; weekday < 7; weekday += 1) await sql`
    INSERT INTO app.business_hours (tenant_id,store_id,weekday,opens_at,closes_at,enabled)
    VALUES (${fixture.tenantId},${fixture.storeId},${weekday},'10:30','20:30',true)
  `;
  await sql`
    INSERT INTO app.sla_policies (
      id,tenant_id,policy_family_id,version,name,applies_to,clock_mode,first_touch_target_minutes,
      salesperson_reminder_minutes,manager_escalation_minutes,owner_escalation_minutes,abandoned_minutes,effective_from
    ) VALUES (
      ${fixture.policyId},${fixture.tenantId},${randomUUID()},1,'Store-hours first touch','domestic','business_hours',5,
      ARRAY[0,3],10,30,120,'2020-01-01T00:00:00Z'
    )
  `;
  await sql`
    INSERT INTO app.users (id,tenant_id,display_name,email,role,status,store_id,available)
    VALUES
      (${fixture.ownerId},${fixture.tenantId},'Owner',${`owner-${fixture.tenantId}@test.local`},'owner','active',${fixture.storeId},true),
      (${fixture.salespersonA},${fixture.tenantId},'Asha',${`a-${fixture.tenantId}@test.local`},'salesperson','active',${fixture.storeId},true),
      (${fixture.salespersonB},${fixture.tenantId},'Bina',${`b-${fixture.tenantId}@test.local`},'salesperson','active',${fixture.storeId},true),
      (${fixture.disabledSalesperson},${fixture.tenantId},'Disabled',${`disabled-${fixture.tenantId}@test.local`},'salesperson','disabled',${fixture.storeId},true)
  `;
  return fixture;
}

export async function insertLead(fixture: Fixture, values: {
  assignedTo?: string;
  externalId?: string;
  phone?: string;
  stage?: "new" | "contacted" | "follow_up" | "dormant" | "won" | "dead" | "bad";
  receivedAt?: Date;
  firstContactedAt?: Date | null;
  firstResponseMinutes?: number | null;
  closedAt?: Date | null;
  outcomeReason?: string | null;
  updatedAt?: Date;
  source?: "csv_import" | "meta_lead_form";
}) {
  const id = randomUUID();
  const receivedAt = values.receivedAt ?? new Date();
  const stage = values.stage ?? "new";
  await sql`
    INSERT INTO app.leads (
      id,tenant_id,source,external_id,full_name,phone_e164,phone_raw,custom_fields,stage,conversation_state,
      assigned_to,assigned_at,store_id,lead_created_at,received_at,first_contacted_at,first_response_minutes,
      sla_policy_version_id,sla_due_at,closed_at,closed_by,outcome_reason,order_value,updated_at
    ) VALUES (
      ${id},${fixture.tenantId},${values.source ?? "csv_import"},${values.externalId ?? randomUUID()},'Test Lead',
      ${values.phone ?? `+91${String(Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000)}`},'test','{}',${stage},
      ${["won","dead","bad"].includes(stage) ? "closed" : "waiting_on_us"},${values.assignedTo ?? fixture.salespersonA},${receivedAt},
      ${fixture.storeId},${receivedAt},${receivedAt},${values.firstContactedAt ?? null},${values.firstResponseMinutes ?? null},
      ${fixture.policyId},${new Date(receivedAt.getTime() + 5 * 60_000)},${values.closedAt ?? null},
      ${values.closedAt ? fixture.ownerId : null},${values.outcomeReason ?? null},${stage === "won" ? 1000 : null},${values.updatedAt ?? receivedAt}
    )
  `;
  return id;
}

export function sessionFor(fixture: Fixture, id = fixture.ownerId, role: "owner" | "salesperson" | "agency" = "owner") {
  return { id, tenantId: fixture.tenantId, name: role === "owner" ? "Owner" : "Salesperson", role } as const;
}
