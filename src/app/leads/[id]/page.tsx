import { notFound } from "next/navigation";
import { LeadDetail } from "@/components/lead-detail";
import { readSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getLeadDetailView } from "@/services/read-models";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await readSession();
  if (!user) redirect("/login");
  const detail = await getLeadDetailView(user, id);
  if (!detail) notFound();
  return <LeadDetail lead={detail.lead} initialTimeline={detail.timeline} assignees={detail.assignees} user={user} />;
}
