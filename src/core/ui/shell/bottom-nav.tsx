"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useMemo } from "react";

import { cn } from "@/core/lib/utils";
import {
  markLive,
  TAB_ATTRIBUTE,
  TAB_HOME_ATTRIBUTE,
  TAB_TOP_ATTRIBUTE,
} from "@/core/ui/navigation/attributes";

import { MoreSheet } from "./more-sheet";
import { isActivePath, type NavItem, PROFILE_NAV_ITEM } from "./nav";
import { NAV_ICONS } from "./nav-icons";
import { usePrefetchTabs, useTabNavigation } from "./tab-history";

/**
 * Shared shape for a bar item, link or More button. `min-h-14` with a 44px inner target and
 * 8px of breathing room satisfies §14.1; the whole cell is tappable, not just the icon.
 */
const ITEM =
  "relative flex min-h-14 w-full flex-col items-center justify-center gap-1 px-1 text-[11px] leading-none outline-none transition-colors focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset";

/**
 * The icon sits in a pill that fills when the destination is current, with a heavier icon and
 * label: it reads at arm's length in daylight (task 1.5). **Neutral, not red** (ARCHITECTURE
 * §14.1, the action colour rule): red is the commit action, error text and the count badge.
 */
function Item({
  icon,
  label,
  active,
  badge,
}: {
  icon: NavItem["icon"];
  label: string;
  active: boolean;
  /** Things waiting for the viewer behind this destination, streamed by the shell (`NavCount`). */
  badge?: NavItemBadge | undefined;
}) {
  const Icon = NAV_ICONS[icon];
  return (
    <>
      <span
        data-slot="nav-pill"
        className={cn(
          "relative flex h-7 w-12 max-w-full items-center justify-center rounded-full transition-colors",
          active && "bg-foreground/10",
        )}
      >
        <Icon
          className={cn("size-5", active ? "text-foreground" : "text-muted-foreground")}
          strokeWidth={active ? 2.25 : 1.75}
          aria-hidden
        />
        {badge?.mark}
      </span>
      <span
        data-slot="nav-label"
        className={cn(
          "max-w-full truncate",
          active ? "text-foreground font-semibold" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      {/* The number is decoration next to the label; this is what a screen reader hears. */}
      {badge?.words}
    </>
  );
}

/** A bar item's count, in its two places: the disc on the icon and the words after the label. */
export type NavItemBadge = { mark: ReactNode; words: ReactNode };

/**
 * Bottom navigation, **for every role** (ARCHITECTURE §14.1, task 1.5 — before it, only Staff
 * had one and Owner and Admin opened a drawer). Four primary destinations plus More; Staff get
 * their five from PRODUCT §4.7 and no More. Hidden from `md` up, where the sidebar takes over.
 *
 * The split itself lives in `nav.ts` (`MOBILE_PRIMARY`), not here.
 */
export function BottomNav({
  primary,
  more,
  home,
  logoutItem,
  badges = {},
  moreBadge,
  sheetBadges = {},
}: {
  primary: readonly NavItem[];
  more: readonly NavItem[];
  /** Each bar item's count by key, streamed by the shell (2.4, 4C). */
  badges?: Readonly<Partial<Record<string, NavItemBadge>>>;
  /** What waits behind More, added up, so nothing needing the viewer hides in the sheet. */
  moreBadge?: NavItemBadge;
  /** The More sheet's rows' counts by key. */
  sheetBadges?: Readonly<Partial<Record<string, ReactNode>>>;
  /** The role's home tab: where back from any other tab lands when installed (`tab-history`). */
  home: string;
  logoutItem?: ReactNode;
}) {
  const pathname = usePathname();
  // Every top-level destination, bar and sheet alike (the profile row included), so switching
  // between them never stacks up: a page opened from More is a tab root (ARCHITECTURE §14.2 c).
  const topLevel = useMemo(
    () => [
      ...[...primary, ...more].map((item) => item.href),
      ...(more.length > 0 ? [PROFILE_NAV_ITEM.href] : []),
    ],
    [primary, more],
  );
  const tabs = useTabNavigation(home, pathname, topLevel);
  usePrefetchTabs(topLevel, pathname);
  const { navigate } = tabs;
  const hasMore = more.length > 0;
  // Everything the sheet can reach, so "you are here" still holds after you open one of them.
  const moreActive =
    hasMore && [...more, PROFILE_NAV_ITEM].some((item) => isActivePath(pathname, item.href));
  const columns = primary.length + (hasMore ? 1 : 0);

  return (
    <nav
      aria-label="Main"
      data-slot="bottom-nav"
      // What the pre-hydration script needs to make the same tab moves (task 2.8).
      {...{ [TAB_HOME_ATTRIBUTE]: home, [TAB_TOP_ATTRIBUTE]: topLevel.join(" ") }}
      className="border-border bg-background/95 supports-[backdrop-filter]:bg-background/80 fixed inset-x-0 bottom-0 z-40 border-t pb-[var(--app-safe-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {primary.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <li key={item.key} className="flex">
              <Link
                href={item.href}
                data-nav={item.key}
                {...{ [TAB_ATTRIBUTE]: "" }}
                ref={markLive}
                data-active={active ? "" : undefined}
                aria-current={active ? "page" : undefined}
                className={cn(ITEM, "pressable")}
                // Installed: tabs replace each other over home instead of stacking. In a browser
                // tab `navigate` returns false and this stays an ordinary link.
                onClick={(event) => {
                  if (event.defaultPrevented || event.metaKey || event.ctrlKey) return;
                  if (navigate(item.href)) event.preventDefault();
                }}
              >
                <Item
                  icon={item.icon}
                  label={item.label}
                  active={active}
                  badge={badges[item.key]}
                />
              </Link>
            </li>
          );
        })}
        {hasMore ? (
          <li className="flex">
            <MoreSheet
              items={more}
              badges={sheetBadges}
              tabs={tabs}
              logoutItem={logoutItem}
              trigger={
                <button
                  type="button"
                  data-nav="more"
                  data-active={moreActive ? "" : undefined}
                  className={cn(ITEM, "pressable")}
                >
                  <Item icon="more" label="More" active={moreActive} badge={moreBadge} />
                </button>
              }
            />
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
