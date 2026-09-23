import { BarChart3, CircleCheck, Clock3, FileText, LayoutDashboard, Settings, UsersRound } from "lucide-react";
import Link from "next/link";
import type { SessionUser } from "@/lib/auth";

interface NavItem { href: string; label: string; short: string; icon: typeof Clock3; count?: string; alert?: boolean }

const ownerLinks: NavItem[] = [
  { href: "/", label: "Overview", short: "Home", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", short: "Leads", icon: UsersRound },
  { href: "/quality", label: "Lead quality", short: "Quality", icon: CircleCheck },
  { href: "/campaigns", label: "Campaigns", short: "Campaigns", icon: BarChart3 },
  { href: "/reports", label: "Reports", short: "Reports", icon: FileText },
  { href: "/admin", label: "Settings", short: "More", icon: Settings },
];

const salespersonLinks: NavItem[] = [
  { href: "/today", label: "Today", short: "Today", icon: Clock3 },
  { href: "/leads", label: "My leads", short: "Leads", icon: UsersRound },
  { href: "/quality", label: "Lead quality", short: "Quality", icon: CircleCheck },
  { href: "/reports", label: "My results", short: "Results", icon: BarChart3 },
];

export function linksForRole(role: SessionUser["role"]) {
  if (role === "salesperson") return salespersonLinks;
  if (role === "agency") return ownerLinks.filter((item) => ["/", "/campaigns", "/reports"].includes(item.href));
  if (role === "admin") return ownerLinks.filter((item) => ["/", "/leads", "/quality", "/admin"].includes(item.href));
  return ownerLinks;
}

export function DesktopNavigation({ active, user }: { active: string; user: SessionUser }) {
  return <nav aria-label="Main navigation">{linksForRole(user.role).map(({ href, label, icon: Icon, count, alert }) =>
    <Link className={active === href ? "active" : ""} href={href} key={href}>
      <Icon size={18} />{label}{count && <span className="nav-count">{count}</span>}{alert && <span className="nav-dot" />}
    </Link>)}</nav>;
}

export function MobileBottomNav({ active, user }: { active: string; user: SessionUser }) {
  const all = linksForRole(user.role);
  const preferred = user.role === "salesperson"
    ? all
    : all.filter((item) => ["/", "/leads", "/quality", "/reports", "/admin"].includes(item.href));
  return <nav className="mobile-bottom-nav" aria-label="Mobile navigation">{preferred.slice(0, 5).map(({ href, short, icon: Icon, count }) =>
    <Link className={active === href ? "active" : ""} href={href} key={href}><span><Icon size={20} />{count && <i>{count}</i>}</span><small>{short}</small></Link>)}</nav>;
}
