"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/core/lib/utils";

import { isActivePath, type NavItem } from "./nav";
import { NAV_ICONS } from "./nav-icons";

/**
 * Staff navigation on phones: a fixed bar with five 44px-tall targets and a safe-area inset
 * for iPhones installed as a PWA. Hidden from `md` up, where the sidebar takes over.
 */
export function BottomNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      data-slot="bottom-nav"
      className="border-border bg-background/95 supports-[backdrop-filter]:bg-background/80 fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-5">
        {items.map((item) => {
          const active = isActivePath(pathname, item.href);
          const Icon = NAV_ICONS[item.icon];
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                data-nav={item.key}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "text-muted-foreground relative flex min-h-14 flex-col items-center justify-center gap-1 px-1 text-[11px] leading-none transition-colors outline-none",
                  "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset",
                  active &&
                    "text-foreground after:bg-brand after:absolute after:inset-x-4 after:top-0 after:h-0.5 after:rounded-b-full",
                )}
              >
                <Icon className="size-5" strokeWidth={active ? 2.25 : 1.75} aria-hidden />
                <span className={cn("truncate", active && "font-medium")}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
