import { DesktopShell } from "@/components/desktop-shell";
import { LeadInbox } from "@/components/lead-inbox";
import { readSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getLeadList } from "@/services/product-read-models";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await readSession();
  if (!user) redirect("/login");
  const query = await searchParams;
  const leads = await getLeadList(user);
  return <DesktopShell active="/leads" title={user.role === "salesperson" ? "My leads" : "All leads"} eyebrow={user.role === "salesperson" ? `${user.name} · active queue` : `${leads.length} visible leads`}>
    <LeadInbox user={user} initialLeads={leads} initialView={query.view} />
  </DesktopShell>;
}
