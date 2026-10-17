"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/features/auth/actions";
import type { SessionUser } from "@/features/auth/types";
import { BooksIcon, DashboardIcon, InventoryIcon, LogOutIcon, SearchIcon, UserIcon } from "@/components/ui/icons";

const items = [
  { href: "/dashboard", label: "대시보드", Icon: DashboardIcon },
  { href: "/books", label: "책장", Icon: BooksIcon },
  { href: "/inventory", label: "재고", Icon: InventoryIcon },
  { href: "/aladin/search", label: "검색", Icon: SearchIcon },
  { href: "/profile", label: "프로필", Icon: UserIcon }
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function visibleItems(user: SessionUser) {
  return items.filter((item) => item.href !== "/inventory" || user.role === "ADMIN");
}

export function Sidebar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  return (
    <aside className="sidebar" aria-label="주 메뉴">
      <Link href="/dashboard" className="brand"><span className="brand-mark">B</span><span>Bookshelf</span></Link>
      <nav className="sidebar-nav">
        {visibleItems(user).map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return <Link key={href} href={href} className={`nav-link ${active ? "nav-link-active" : ""}`} aria-current={active ? "page" : undefined}><Icon/><span>{label}</span></Link>;
        })}
      </nav>
      <div className="sidebar-account">
        <div className="account-avatar">{(user.name ?? user.username).slice(0, 1).toUpperCase()}</div>
        <div className="account-copy"><strong>{user.name ?? user.username}</strong><span>@{user.username}</span></div>
        <form action={logoutAction}><button className="icon-button" aria-label="로그아웃"><LogOutIcon/></button></form>
      </div>
    </aside>
  );
}

export function MobileNav({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  return (
    <nav className="mobile-nav" aria-label="모바일 주 메뉴" style={{ gridTemplateColumns: `repeat(${visibleItems(user).length}, minmax(0, 1fr))` }}>
      {visibleItems(user).map(({ href, label, Icon }) => {
        const active = isActive(pathname, href);
        return <Link key={href} href={href} className={`mobile-nav-link ${active ? "mobile-nav-link-active" : ""}`} aria-current={active ? "page" : undefined}><Icon/><span>{label}</span></Link>;
      })}
    </nav>
  );
}
