import { DesktopShell } from "@/components/desktop-shell";
import { QualityReview } from "@/components/quality-review";
import { readSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getQualityCases } from "@/services/read-models";

export default async function QualityPage() {
  const user = await readSession();
  if (!user) redirect("/login");
  const rows = await getQualityCases(user);
  return <DesktopShell active="/quality" title={user.role === "salesperson" ? "My lead evidence" : "Lead quality review"} eyebrow={user.role === "salesperson" ? "See what is still needed before closing a lead" : `${rows.length} claims visible`}><QualityReview user={user} rows={rows} /></DesktopShell>;
}
