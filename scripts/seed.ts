import { hash } from "bcryptjs";
import postgres from "postgres";
import { env } from "../src/lib/env";

const settings = env();
if (settings.NODE_ENV === "production") throw new Error("Demo seed is disabled in production.");

const tenantId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const policyId = "33333333-3333-4333-8333-333333333331";
const users = {
  owner: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  ashwini: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  rhea: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
  agency: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
};
const sql = postgres(settings.DATABASE_URL, { prepare: false });
const people = ["Priya Sharma", "Meera Joshi", "Nisha Patel", "Kavita Rao", "Anjali Desai", "Sonal Shah", "Ritika Mehta", "Pooja Anand", "Shreya Malhotra", "Devika Kapoor", "Ayesha Khan", "Rupal Mehta"];

function atIst(daysAgo: number, hour: number, minute: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: "year" | "month" | "day") => Number(parts.find((part) => part.type === type)?.value);
  const date = new Date(Date.UTC(value("year"), value("month") - 1, value("day") - daysAgo));
  const ymd = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}`;
  return new Date(`${ymd}T${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}:00+05:30`);
}

async function main() {
  const passwordHash = await hash("RoopkalaDemo!2026", 12);
  await sql.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    await transaction`SELECT set_config('app.user_role', 'system', true)`;
    await transaction`
      INSERT INTO app.users (id,tenant_id,display_name,phone_e164,email,role,status,store_id,available,password_hash,password_reset_required)
      VALUES
        (${users.ashwini},${tenantId},'Ashwini','+919876543210','ashwini@roopkala.demo','salesperson','active',${storeId},true,${passwordHash},false),
        (${users.rhea},${tenantId},'Rhea','+919876543211','rhea@roopkala.demo','salesperson','active',${storeId},true,${passwordHash},false),
        (${users.owner},${tenantId},'Harsh Shah',NULL,'owner@roopkala.demo','owner','active',NULL,true,${passwordHash},false),
        (${users.agency},${tenantId},'Agency Viewer',NULL,'agency@roopkala.demo','agency','active',NULL,true,${passwordHash},false)
      ON CONFLICT (tenant_id,email) DO UPDATE SET password_hash=excluded.password_hash,role=excluded.role,status='active'
    `;

    for (let index = 0; index < 18; index += 1) {
      const id = `90000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      const daysAgo = index < 6 ? 0 : Math.min(6, Math.floor(index / 3));
      const receivedAt = atIst(daysAgo, 10 + (index % 8), 35 + (index % 4) * 7);
      const assignedTo = index % 2 ? users.rhea : users.ashwini;
      const [lead] = await transaction<{ id: string }[]>`
        INSERT INTO app.leads (id,tenant_id,source,external_id,campaign_id,campaign_name,ad_id,ad_name,full_name,phone_e164,phone_raw,city,custom_fields,stage,conversation_state,assigned_to,assigned_at,store_id,lead_created_at,received_at,sla_policy_version_id,sla_due_at)
        VALUES (${id},${tenantId},'csv_import',${`demo-sheet-${index + 1}`},${`campaign-${index % 3}`},${["Wedding Edit","Festive Silks","Bridal Consultation"][index % 3]},${`ad-${index % 4}`},${["Pink Kanjivaram","Wedding Reel","Designer Saree","Bridal Story"][index % 4]},${people[index % people.length]},${`+91981000${String(index + 1).padStart(4,"0")}`},${`981000${String(index + 1).padStart(4,"0")}`},${["Mumbai","Thane","Pune","Dubai"][index % 4]},'{}', 'new','waiting_on_us',${assignedTo},${receivedAt},${storeId},${receivedAt},${receivedAt},${policyId},${new Date(receivedAt.getTime()+5*60_000)})
        ON CONFLICT (tenant_id,source,external_id) DO UPDATE SET full_name=excluded.full_name RETURNING id
      `;
      await transaction`
        INSERT INTO app.lead_events (tenant_id,lead_id,event_type,actor_type,payload,occurred_at)
        SELECT ${tenantId},${lead.id},'lead_received','system',${transaction.json({ source: "csv_import", seeded: true })},${receivedAt}
        WHERE NOT EXISTS (SELECT 1 FROM app.lead_events WHERE tenant_id=${tenantId} AND lead_id=${lead.id} AND event_type='lead_received')
      `;
      if (index >= 5) {
        const firstAttempt = new Date(receivedAt.getTime() + (index % 4 + 1) * 60_000);
        await transaction`INSERT INTO app.attempts (tenant_id,lead_id,user_id,channel,initiated_at) VALUES (${tenantId},${lead.id},${assignedTo},${index % 3 === 0 ? "whatsapp" : "call"},${firstAttempt})`;
      }
      if (index === 8 || index === 9) await transaction`UPDATE app.leads SET stage='dormant' WHERE tenant_id=${tenantId} AND id=${lead.id}`;
      if (index === 10) await transaction`UPDATE app.leads SET stage='won',outcome_reason=NULL,order_value=78500,closed_at=clock_timestamp(),closed_by=${users.owner},conversation_state='closed' WHERE tenant_id=${tenantId} AND id=${lead.id}`;
      if (index === 11) await transaction`UPDATE app.leads SET stage='dead',outcome_reason='bought_elsewhere',closed_at=clock_timestamp(),closed_by=${users.owner},conversation_state='closed' WHERE tenant_id=${tenantId} AND id=${lead.id}`;
      if (index === 12) await transaction`UPDATE app.leads SET stage='bad',outcome_reason='wrong_number',closed_at=clock_timestamp(),closed_by=${users.owner},conversation_state='closed' WHERE tenant_id=${tenantId} AND id=${lead.id}`;
    }
    await transaction`UPDATE app.lead_followups SET status='missed' WHERE tenant_id=${tenantId} AND due_date < (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date AND status='pending'`;
  });
}

main().then(() => process.stdout.write("Seeded Block 1 demo data. Sign in with any demo email and RoopkalaDemo!2026\n")).finally(() => sql.end());
