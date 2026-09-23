import { BarChart3, Clock3, LayoutDashboard, Settings, UsersRound } from "lucide-react";
import Link from "next/link";
import type { SessionUser } from "@/lib/auth";

interface NavItem { href: string; label: string; short: string; icon: typeof Clock3; count?: string; alert?: boolean }

const ownerLinks: NavItem[] = [
  { href: "/", label: "Dashboard", short: "Home", icon: LayoutDashboard },
  { href: "/today", label: "Today queue", short: "Today", icon: Clock3 },
  { href: "/leads", label: "Leads", short: "Leads", icon: UsersRound },
  { href: "/admin", label: "Settings", short: "More", icon: Settings },
];

const salespersonLinks: NavItem[] = [
  { href: "/today", label: "Today", short: "Today", icon: Clock3 },
  { href: "/leads", label: "My leads", short: "Leads", icon: UsersRound },
  { href: "/", label: "My results", short: "Results", icon: BarChart3 },
];

export function linksForRole(role: SessionUser["role"]) {
  if (role === "salesperson") return salespersonLinks;
  if (role === "agency") return ownerLinks.filter((item) => item.href === "/");
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
  const preferred = all;
  return <nav className="mobile-bottom-nav" aria-label="Mobile navigation">{preferred.slice(0, 5).map(({ href, short, icon: Icon, count }) =>
    <Link className={active === href ? "active" : ""} href={href} key={href}><span><Icon size={20} />{count && <i>{count}</i>}</span><small>{short}</small></Link>)}</nav>;
}
