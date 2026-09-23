import { DesktopShell } from "@/components/desktop-shell";
import { AdminConsole } from "@/components/admin-console";
import { readSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function AdminPage() {
  const user = await readSession();
  if (!user) redirect("/login");
  if (!(["owner", "admin", "manager"] as string[]).includes(user.role)) redirect(user.role === "salesperson" ? "/today" : "/campaigns");
  return <DesktopShell active="/admin" title={user.role === "admin" ? "Admin settings" : "Settings"} eyebrow={`${user.name} · ${user.role === "admin" ? "System administrator" : "Owner access"}`}><AdminConsole /></DesktopShell>;
}
