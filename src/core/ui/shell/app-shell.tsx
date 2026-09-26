import type { ReactNode } from "react";

import { BottomNav } from "./bottom-nav";
import { MobileChrome } from "./mobile-chrome";
import {
  alertsInBottomNav,
  homeFor,
  mobileNavFor,
  type NavBadges,
  navFor,
  withBadges,
} from "./nav";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import type { ShellViewer } from "./viewer";

/**
 * The signed-in app chrome.
 *
 * **Phone** (below `md`): a bottom bar for **every role** — four primary destinations plus More,
 * or Staff's five (ARCHITECTURE §14.1, task 1.5). The brand bar above it slides away as you
 * scroll. Nobody opens a drawer to reach a screen they use every day.
 *
 * **Tablet and desktop** (`md` up): the sidebar, unchanged.
 *
 * `logoutItem` / `logoutSheetItem` are the Log out action in the account menu and in the More
 * sheet. `core/auth` owns them and the app layout passes them in, so `core/ui` never imports
 * auth. Log out is in both because it records the time (WORKFLOWS §1).
 *
 * `badges` are the viewer's counts per nav key (Approvals since 2.4), computed by the layout
 * from real data; every place that draws the item draws the count.
 */
export function AppShell({
  viewer,
  logoutItem,
  logoutSheetItem,
  badges = {},
  children,
}: {
  viewer: ShellViewer;
  logoutItem?: ReactNode;
  logoutSheetItem?: ReactNode;
  badges?: NavBadges;
  children: ReactNode;
}) {
  const items = withBadges(navFor(viewer.role), badges);
  const home = homeFor(viewer.role);
  const mobile = mobileNavFor(viewer.role);
  const primary = withBadges(mobile.primary, badges);
  const more = withBadges(mobile.more, badges);

  return (
    <div
      className="bg-background text-foreground flex min-h-dvh"
      // The page title bar reads this to decide whether to carry the bell: when the bottom bar
      // already has an Alerts destination (Staff), a second bell is noise.
      data-alerts={alertsInBottomNav(viewer.role) ? "nav" : "bar"}
    >
      <a
        href="#main"
        className="bg-card text-foreground ring-ring sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:px-3 focus:py-2 focus:text-sm focus:ring-2"
      >
        Skip to content
      </a>
      <MobileChrome />
      <Sidebar home={home} items={items} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar viewer={viewer} home={home} logoutItem={logoutItem} />
        <main
          id="main"
          tabIndex={-1}
          // No top padding on a phone: the sticky title bar provides the separation, and the
          // first real row of content has to be visible without scrolling (§14.1).
          className="mx-auto w-full max-w-[80rem] flex-1 px-4 pt-0 pb-[calc(var(--app-bottom-nav-h)+1.5rem+var(--app-safe-bottom))] md:px-6 md:py-6 lg:px-8"
        >
          {children}
        </main>
      </div>
      <BottomNav primary={primary} more={more} home={home} logoutItem={logoutSheetItem} />
    </div>
  );
}
