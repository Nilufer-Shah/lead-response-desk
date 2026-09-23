import postgres from "postgres";
import { env } from "../src/lib/env";

const tenantId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const policyId = "33333333-3333-4333-8333-333333333331";
const sql = postgres(env().DATABASE_URL, { prepare: false });

const names = ["Priya Sharma", "Meera Joshi", "Nisha Patel", "Kavita Rao", "Anjali Desai", "Sonal Shah", "Ritika Mehta", "Pooja Anand", "Shreya Malhotra", "Devika Kapoor"];
const cities = ["Andheri", "Bandra", "Santacruz", "Powai", "Juhu", "Borivali", "Thane", "Navi Mumbai"];
const campaigns = ["Festive Silk Collection", "Wedding Edit", "International Bridal", "Heritage Weaves"];
const userIds = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"];

function responseDelay(index: number): number | null {
  if (index < 70) return 60 + (index % 4) * 60;
  if (index < 110) return 6 * 60 + (index % 9) * 60;
  if (index < 140) return 16 * 60 + (index % 40) * 60;
  if (index < 176) return 61 * 60 + (index % 23) * 37 * 60;
  if (index < 190) return 25 * 60 * 60 + (index % 8) * 60 * 60;
  return null;
}

async function main() {
  await sql.begin(async (transaction) => {
    await transaction`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    await transaction`SELECT set_config('app.user_role', 'system', true)`;
    await transaction`
      INSERT INTO app.users (id, tenant_id, display_name, phone_e164, email, role, status, store_id, available)
      VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', ${tenantId}, 'Ashwini', '+919876543210', null, 'salesperson', 'active', ${storeId}, true),
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', ${tenantId}, 'Rhea', '+919876543211', null, 'salesperson', 'active', ${storeId}, true),
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', ${tenantId}, 'Harsh Shah', null, 'owner@example.com', 'owner', 'active', ${storeId}, true),
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', ${tenantId}, 'Waqar', null, 'agency@example.com', 'agency', 'active', null, true),
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', ${tenantId}, 'Admin', null, 'admin@example.com', 'admin', 'active', null, true)
      ON CONFLICT (id) DO NOTHING
    `;

    for (let index = 0; index < 200; index += 1) {
      const id = `90000000-0000-4000-8${String(index).padStart(3, "0")}-${String(index + 1).padStart(12, "0")}`;
      const created = new Date(Date.now() - (index % 14) * 86_400_000 - (index % 9) * 3_600_000);
      const delay = responseDelay(index);
      const quality = index < 22 ? (index % 3 === 0 ? "spam" : "wrong_person") : "unrated";
      await transaction`
        INSERT INTO app.leads (
          id, tenant_id, source, external_id, campaign_id, campaign_name, ad_id, ad_name,
          full_name, phone_e164, phone_raw, city, custom_fields, stage, conversation_state,
          assigned_to, store_id, lead_created_at, received_at, sla_policy_version_id, sla_due_at,
          quality_flag
        ) VALUES (
          ${id}, ${tenantId}, 'csv_import', ${`demo-${index + 1}`}, ${`campaign-${index % 4}`}, ${campaigns[index % campaigns.length]},
          ${`ad-${index % 8}`}, ${`${campaigns[index % campaigns.length]} · Creative ${String.fromCharCode(65 + index % 3)}`},
          ${`${names[index % names.length]} ${Math.floor(index / names.length) + 1}`}, ${`+9198${String(10000000 + index).slice(-8)}`}, ${`98${String(10000000 + index).slice(-8)}`},
          ${cities[index % cities.length]}, '{}', ${delay === null ? "new" : "contacted"}, ${delay === null ? "waiting_on_us" : "waiting_on_lead"},
          ${userIds[index % userIds.length]}, ${storeId}, ${created}, ${created}, ${policyId}, ${new Date(created.getTime() + 5 * 60_000)}, ${quality}
        ) ON CONFLICT (tenant_id, source, external_id) DO NOTHING
      `;
      if (delay !== null) {
        const firstTouch = new Date(created.getTime() + delay * 1000);
        const attemptTotal = index < 9 ? 1 : 1 + (index % 4);
        for (let attemptIndex = 0; attemptIndex < attemptTotal; attemptIndex += 1) {
          await transaction`
            INSERT INTO app.attempts (tenant_id, lead_id, user_id, channel, initiated_at)
            VALUES (${tenantId}, ${id}, ${userIds[index % userIds.length]}, ${attemptIndex % 3 === 2 ? "whatsapp" : "call"}, ${new Date(firstTouch.getTime() + attemptIndex * 86_400_000)})
          `;
        }
      }
      if (index < 3) {
        await transaction`
          INSERT INTO app.lead_events (tenant_id, lead_id, event_type, actor_type, payload, occurred_at)
          VALUES (${tenantId}, ${id}, 'repeat_enquiry', 'system', ${transaction.json({ previousStage: "lost", enquirySequence: 2 })}, ${new Date(created.getTime() + 7 * 86_400_000)})
        `;
      }
    }
  });
}

main().then(() => process.stdout.write("Seeded 200 leads\n")).finally(() => sql.end());
