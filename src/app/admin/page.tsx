import { DesktopShell } from "@/components/desktop-shell";
import { AdminConsole } from "@/components/admin-console";
import { readSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function AdminPage() {
  const user = await readSession();
  if (!user) redirect("/login");
  if (user.role !== "owner") redirect(user.role === "salesperson" ? "/today" : "/");
  return <DesktopShell active="/admin" title="Settings" eyebrow={`${user.name} · Owner access`}><AdminConsole /></DesktopShell>;
}
