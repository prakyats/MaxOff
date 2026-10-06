import { type ReactNode, Suspense } from "react";

import type { ServerUnread } from "@/core/notifications/read-receipts";

import { BellCountProvider } from "./bell-count";
import { BottomNav, type NavItemBadge } from "./bottom-nav";
import { MobileChrome } from "./mobile-chrome";
import { PullToRefreshLazy } from "./pull-to-refresh-lazy";
import {
  alertsInBottomNav,
  badgeTotal,
  homeFor,
  mobileNavFor,
  type NavBadges,
  type NavItem,
  navFor,
  PROFILE_NAV_ITEM,
} from "./nav";
import type { NavBadgePlace } from "./nav-badge";
import { NavCount } from "./nav-count";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import type { ShellViewer } from "./viewer";

const NO_BADGES: Promise<NavBadges> = Promise.resolve({});
const NO_UNREAD: Promise<ServerUnread | null> = Promise.resolve(null);

/**
 * The signed-in app chrome.
 *
 * **Phone** (below `md`): a bottom bar for **every role** — four primary destinations plus More,
 * or the Crew's five (ARCHITECTURE §14.1, task 1.5; 5B decision 1). The brand bar above it slides away as you
 * scroll. Nobody opens a drawer to reach a screen they use every day.
 *
 * **Tablet and desktop** (`md` up): the sidebar, unchanged.
 *
 * `logoutItem` / `logoutSheetItem` are an optional sign-out action in the account menu and the More
 * sheet. `core/auth` owns them and the app layout passes them in, so `core/ui` never imports
 * auth. Since 3b.1 the layout passes neither: "Sign out of this device" lives under Me only
 * (kickoff 3b decision 1), because signing out is no longer attendance.
 *
 * `badges` are the viewer's counts per nav key (Approvals since 2.4, Tasks since 4.5, Alerts and
 * the desktop bell since 5.1: the unread notifications), a
 * promise the layout starts and never waits for: each count streams into its own `<Suspense>`
 * (`NavCount`, 4C), so the shell, the page and its loading screen never wait for the counts, and
 * every place that draws the item draws the count. Server-rendered: no JavaScript of their own,
 * but for the bell's: `unread` is the same count with the server's clock, drawn by a small client
 * piece so the member's own reads come off it on the device at once (owner decision 2026-10-01).
 */
export function AppShell({
  viewer,
  logoutItem,
  logoutSheetItem,
  badges = NO_BADGES,
  unread = NO_UNREAD,
  children,
}: {
  viewer: ShellViewer;
  logoutItem?: ReactNode;
  logoutSheetItem?: ReactNode;
  badges?: Promise<NavBadges>;
  /** The bell's count with the server's clock (`readUnread()`); null when it could not be read. */
  unread?: Promise<ServerUnread | null>;
  children: ReactNode;
}) {
  const items = navFor(viewer.role);
  const home = homeFor(viewer.role);
  const mobile = mobileNavFor(viewer.role);
  const { primary, more } = mobile;
  // One streamed count per spot (Suspense with no fallback: a count appears when it is known).
  const count = (keys: readonly string[], place: NavBadgePlace, part?: "mark" | "words") => (
    <Suspense fallback={null}>
      <NavCount
        counts={badges}
        unread={unread}
        keys={keys}
        place={place}
        {...(part ? { part } : {})}
      />
    </Suspense>
  );
  const barBadge = (keys: readonly string[]): NavItemBadge => ({
    mark: count(keys, "bar"),
    words: count(keys, "bar", "words"),
  });
  const byKey = <T,>(list: readonly NavItem[], make: (key: string) => T) =>
    Object.fromEntries(list.map((item) => [item.key, make(item.key)]));
  // Every tab's first screen, whichever bar or sidebar reaches it: where a pull refreshes.
  const tabRoots = [...new Set([home, PROFILE_NAV_ITEM.href, ...items.map((item) => item.href)])];

  // The title bar's bell (in each page's header) reads the same count through context.
  const bell = Promise.all([unread, badges]).then(
    ([server, counts]): ServerUnread =>
      server ?? { count: badgeTotal(counts, ["alerts"]), countedAt: Number.NEGATIVE_INFINITY },
  );

  return (
    <BellCountProvider count={bell}>
      <div
        className="bg-background text-foreground flex min-h-dvh"
        // The page title bar reads this to decide whether to carry the bell: when the bottom bar
        // already has an Alerts destination, a second bell is noise. Since 5B decision 1 no
        // role's bar has one, so every title bar carries the bell.
        data-alerts={alertsInBottomNav(viewer.role) ? "nav" : "bar"}
      >
        {/* pressable: none (a skip link: it takes keyboard focus, nobody taps it) */}
        <a
          href="#main"
          className="bg-card text-foreground ring-ring sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:px-3 focus:py-2 focus:text-sm focus:ring-2"
        >
          Skip to content
        </a>
        <MobileChrome />
        <Sidebar home={home} items={items} badges={byKey(items, (key) => count([key], "list"))} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            viewer={viewer}
            home={home}
            logoutItem={logoutItem}
            bellCount={
              <>
                {count(["alerts"], "bar")}
                {count(["alerts"], "bar", "words")}
              </>
            }
          />
          <main
            id="main"
            tabIndex={-1}
            // No top padding on a phone: the sticky title bar provides the separation, and the
            // first real row of content has to be visible without scrolling (§14.1).
            className="mx-auto w-full max-w-[80rem] flex-1 px-4 pt-0 pb-[calc(var(--app-bottom-nav-h)+1.5rem+var(--app-safe-bottom)+var(--app-bands-h,0px))] md:px-6 md:py-6 md:pb-[calc(1.5rem+var(--app-bands-h,0px))] lg:px-8"
          >
            {children}
          </main>
        </div>
        <BottomNav
          primary={primary}
          more={more}
          home={home}
          logoutItem={logoutSheetItem}
          badges={byKey(primary, (key) => barBadge([key]))}
          {...(more.length > 0 ? { moreBadge: barBadge(more.map((item) => item.key)) } : {})}
          sheetBadges={byKey(more, (key) => count([key], "sheet"))}
        />
        <PullToRefreshLazy tabRoots={tabRoots} />
      </div>
    </BellCountProvider>
  );
}
