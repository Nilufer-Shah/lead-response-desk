import { NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db";
import { readSession } from "@/lib/auth";
import { ingestLead } from "@/services/lead-intake";
import type { LeadSource } from "@/domain/types";

interface ClosedLead {
  id: string;
  source: LeadSource;
  full_name: string | null;
  full_name_raw: string | null;
  phone_raw: string | null;
  phone_e164: string | null;
  email: string | null;
  city: string | null;
  campaign_name: string | null;
  campaign_id: string | null;
  adset_name: string | null;
  adset_id: string | null;
  ad_name: string | null;
  ad_id: string | null;
  form_id: string | null;
  form_name: string | null;
  custom_fields: Record<string, unknown>;
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await readSession();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role === "agency") return NextResponse.json({ error: "Agency access is read-only" }, { status: 403 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Lead ID is invalid" }, { status: 400 });

  const result = await withTenant(user, async (transaction) => {
    const [lead] = await transaction<ClosedLead[]>`
      SELECT id,source,full_name,full_name_raw,phone_raw,phone_e164,email,city,campaign_name,campaign_id,
        adset_name,adset_id,ad_name,ad_id,form_id,form_name,custom_fields
      FROM app.leads
      WHERE tenant_id=${user.tenantId} AND id=${id} AND stage IN ('won','dead','bad')
      FOR UPDATE
    `;
    if (!lead) return null;
    const created = await ingestLead(transaction, user.tenantId, {
      source: lead.source,
      externalId: `manual-repeat-${crypto.randomUUID()}`,
      arrivedAt: new Date(),
      fullNameRaw: lead.full_name_raw ?? lead.full_name,
      phoneRaw: lead.phone_e164 ?? lead.phone_raw,
      emailRaw: lead.email,
      city: lead.city,
      campaignName: lead.campaign_name,
      campaignId: lead.campaign_id,
      adsetName: lead.adset_name,
      adsetId: lead.adset_id,
      adName: lead.ad_name,
      adId: lead.ad_id,
      formId: lead.form_id,
      formName: lead.form_name,
      customFields: lead.custom_fields,
      eventPayload: { trigger: "manual_repeat_enquiry", previousLeadId: lead.id, actorId: user.id },
    });
    await transaction`
      INSERT INTO app.audit_log (tenant_id,actor_id,action,target_type,target_id,payload)
      VALUES (${user.tenantId},${user.id},'lead_repeat_enquiry_created','lead',${created.leadId},${transaction.json({ previousLeadId: lead.id, result: created.action })})
    `;
    return created;
  });

  if (!result) return NextResponse.json({ error: "Only a Won, Dead or Bad lead can start a new enquiry" }, { status: 409 });
  return NextResponse.json({ leadId: result.leadId, action: result.action }, { status: 201 });
}
