import { redirect } from "next/navigation";
import { DesktopShell } from "@/components/desktop-shell";
import { ProductDashboard } from "@/components/product-dashboard";
import { readSession } from "@/lib/auth";
import { getProductDashboard } from "@/services/product-read-models";

export default async function Home() {
  const user = await readSession();
  if (!user) redirect("/login");
  const data = await getProductDashboard(user, "today");
  return <DesktopShell active="/" title={user.role === "salesperson" ? "My dashboard" : user.role === "agency" ? "Campaign outcomes" : "Lead desk dashboard"} eyebrow="Live operations · Asia/Kolkata">
    <ProductDashboard user={user} initialData={data} />
  </DesktopShell>;
}
