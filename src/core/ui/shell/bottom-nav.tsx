"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";

import { MoreSheet } from "./more-sheet";
import { isActivePath, type NavItem, PROFILE_NAV_ITEM, totalBadge } from "./nav";
import { NAV_ICONS } from "./nav-icons";

/**
 * Shared shape for a bar item, link or More button. `min-h-14` with a 44px inner target and
 * 8px of breathing room satisfies §14.1; the whole cell is tappable, not just the icon.
 */
const ITEM =
  "relative flex min-h-14 w-full flex-col items-center justify-center gap-1 px-1 text-[11px] leading-none outline-none transition-colors focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset";

/**
 * The icon sits in a pill that fills with brand colour when the destination is current. A tint
 * plus a heavier icon and label reads at arm's length in daylight, which a 2px hairline on the
 * top edge did not (task 1.5).
 */
function Item({
  icon,
  label,
  active,
  badge = 0,
}: {
  icon: NavItem["icon"];
  label: string;
  active: boolean;
  /** Things waiting for the viewer behind this destination; 0 shows nothing. */
  badge?: number;
}) {
  const Icon = NAV_ICONS[icon];
  return (
    <>
      <span
        className={cn(
          "relative flex h-7 w-12 items-center justify-center rounded-full transition-colors",
          active && "bg-brand/15",
        )}
      >
        <Icon
          className={cn("size-5", active ? "text-brand" : "text-muted-foreground")}
          strokeWidth={active ? 2.25 : 1.75}
          aria-hidden
        />
        {badge > 0 ? (
          <span
            data-slot="nav-badge"
            // The ring punches the badge out of the icon so it stays readable over either.
            className="bg-brand text-brand-foreground ring-background absolute -top-0.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold ring-2"
          >
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "max-w-full truncate",
          active ? "text-foreground font-semibold" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      {/* The number is decoration next to the label; this is what a screen reader hears. */}
      {badge > 0 ? <span className="sr-only">{badge} waiting</span> : null}
    </>
  );
}

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
  logoutItem,
}: {
  primary: readonly NavItem[];
  more: readonly NavItem[];
  logoutItem?: ReactNode;
}) {
  const pathname = usePathname();
  const hasMore = more.length > 0;
  // Everything the sheet can reach, so "you are here" still holds after you open one of them.
  const moreActive =
    hasMore && [...more, PROFILE_NAV_ITEM].some((item) => isActivePath(pathname, item.href));
  // What is waiting behind More, added up, so nothing needing the viewer hides in the sheet.
  const moreBadge = totalBadge(more);
  const columns = primary.length + (hasMore ? 1 : 0);

  return (
    <nav
      aria-label="Main"
      data-slot="bottom-nav"
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
                data-active={active ? "" : undefined}
                aria-current={active ? "page" : undefined}
                className={cn(ITEM, "active:bg-muted/60")}
              >
                <Item
                  icon={item.icon}
                  label={item.label}
                  active={active}
                  {...(item.badge === undefined ? {} : { badge: item.badge })}
                />
              </Link>
            </li>
          );
        })}
        {hasMore ? (
          <li className="flex">
            <MoreSheet
              items={more}
              logoutItem={logoutItem}
              trigger={
                <button
                  type="button"
                  data-nav="more"
                  data-active={moreActive ? "" : undefined}
                  className={cn(ITEM, "active:bg-muted/60")}
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
