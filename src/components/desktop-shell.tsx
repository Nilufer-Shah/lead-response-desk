import { LogOut } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { DesktopNavigation, MobileBottomNav } from "@/components/app-navigation";
import { readSession } from "@/lib/auth";

export async function DesktopShell({ active, title, eyebrow, children }: { active: string; title: string; eyebrow?: string; children: React.ReactNode }) {
  const user = await readSession();
  if (!user) redirect("/login");
  const initials = user.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const roleLabel = user.role === "salesperson" ? "Salesperson" : user.role === "agency" ? "Agency · read only" : user.role[0].toUpperCase() + user.role.slice(1);
  return <div className="app-shell">
    <aside className="sidebar">
      <Link className="brand-mark" href="/" aria-label="Roopkala Lead Desk home"><span className="logo-crop"><Image src="/roopkala-logo.webp" alt="Roopkala" width={609} height={336} unoptimized /></span><div><strong>Roopkala</strong><small>Lead Desk</small></div></Link>
      <DesktopNavigation active={active} user={user} />
      <div className="sidebar-foot"><div className="avatar">{initials}</div><div><strong>{user.name}</strong><small>{roleLabel}</small></div><form action="/api/auth/logout" method="post"><button aria-label="Switch account" title="Switch account"><LogOut size={16} /></button></form></div>
    </aside>
    <main className="main-stage page-stage">
      <header className="mobile-product-head"><Link href={user.role === "salesperson" ? "/today" : "/"}><span className="mobile-logo-crop"><Image src="/roopkala-logo.webp" alt="" width={609} height={336} unoptimized /></span><strong>Roopkala Lead Desk</strong></Link><span>{roleLabel}</span></header>
      <header className="topbar"><div><p>{eyebrow ?? "Roopkala Lead Desk"}</p><h1>{title}</h1></div><div className="workspace-state"><span className="role-badge">{roleLabel}</span><div className="live-pill"><span />Live</div></div></header>{children}
    </main>
    <MobileBottomNav active={active} user={user} />
  </div>;
}
