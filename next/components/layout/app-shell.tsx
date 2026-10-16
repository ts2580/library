import type { ReactNode } from "react";
import type { SessionUser } from "@/features/auth/types";
import { MobileNav, Sidebar } from "@/components/layout/navigation";

export function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">본문으로 건너뛰기</a>
      <Sidebar user={user}/>
      <main id="main-content" className="main-content">{children}</main>
      <MobileNav user={user}/>
    </div>
  );
}
