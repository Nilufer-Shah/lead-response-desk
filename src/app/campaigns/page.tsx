import { redirect } from "next/navigation";
import { DesktopShell } from "@/components/desktop-shell";
import { readSession } from "@/lib/auth";
import { getCampaignSummaries } from "@/services/read-models";

function duration(value: number | null) { return value == null ? "Untouched" : `${Math.floor(value / 60)}m ${String(value % 60).padStart(2, "0")}s`; }

export default async function CampaignsPage() {
  const user = await readSession();
  if (!user) redirect("/login");
  const campaigns = await getCampaignSummaries(user);
  return <DesktopShell active="/campaigns" title="Campaign performance" eyebrow="Lead quality and follow-up, separated">
    <section className="panel data-panel"><div className="panel-title"><div><h2>From campaign to store visit</h2><p>Response and outcome data is live. Spend appears after Meta is connected.</p></div><span className="deferred-badge">Meta setup pending</span></div><div className="table-scroll"><table><thead><tr><th>Campaign</th><th>Leads</th><th>Median response</th><th>Connect rate</th><th>Visits booked</th><th>Spend</th><th>Cost / visit</th></tr></thead><tbody>{campaigns.map((campaign) => <tr key={campaign.name}><td><strong>{campaign.name}</strong></td><td>{campaign.leads}</td><td>{duration(campaign.medianSeconds)}</td><td>{campaign.connect}%</td><td>{campaign.visits}</td><td>{campaign.spend == null ? "Pending Meta" : `₹${new Intl.NumberFormat("en-IN").format(campaign.spend)}`}</td><td>{campaign.spend == null || !campaign.visits ? "—" : `₹${new Intl.NumberFormat("en-IN").format(Math.round(campaign.spend / campaign.visits))}`}</td></tr>)}</tbody></table></div></section>
  </DesktopShell>;
}
