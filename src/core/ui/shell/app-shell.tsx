import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";

import { BottomNav } from "./bottom-nav";
import { MobileNavSheet } from "./mobile-nav-sheet";
import { homeFor, navFor } from "./nav";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import type { ShellViewer } from "./viewer";

/**
 * The signed-in app chrome (ROADMAP 0.3). CEO and Admin get a sidebar (a sheet below `md`);
 * Staff get a bottom bar on phones and the same sidebar from `md` up. Pages render inside
 * `<main>` at a comfortable reading width; Staff screens are laid out for 375px first.
 * `logoutItem` is the account menu's Log out entry, owned by `core/auth` and passed in by the
 * app layout.
 */
export function AppShell({
  viewer,
  logoutItem,
  children,
}: {
  viewer: ShellViewer;
  logoutItem?: ReactNode;
  children: ReactNode;
}) {
  const items = navFor(viewer.role);
  const home = homeFor(viewer.role);
  const isStaff = viewer.role === "staff";

  return (
    <div className="bg-background text-foreground flex min-h-dvh">
      <a
        href="#main"
        className="bg-card text-foreground ring-ring sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:px-3 focus:py-2 focus:text-sm focus:ring-2"
      >
        Skip to content
      </a>
      <Sidebar home={home} items={items} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          viewer={viewer}
          home={home}
          leading={isStaff ? null : <MobileNavSheet items={items} />}
          logoutItem={logoutItem}
        />
        <main
          id="main"
          tabIndex={-1}
          className={cn(
            "mx-auto w-full max-w-[80rem] flex-1 px-4 py-6 sm:px-6 lg:px-8",
            isStaff && "pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-6",
          )}
        >
          {children}
        </main>
      </div>
      {isStaff ? <BottomNav items={items} /> : null}
    </div>
  );
}
