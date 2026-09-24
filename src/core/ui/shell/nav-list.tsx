"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/core/lib/utils";

import { isActivePath, type NavItem } from "./nav";
import { NAV_ICONS } from "./nav-icons";

/** Vertical navigation list with the active route highlighted. Used by the sidebar and the mobile sheet. */
export function NavList({
  items,
  onNavigate,
  className,
}: {
  items: readonly NavItem[];
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className={className}>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const active = isActivePath(pathname, item.href);
          const Icon = NAV_ICONS[item.icon];
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                data-nav={item.key}
                aria-current={active ? "page" : undefined}
                {...(onNavigate ? { onClick: onNavigate } : {})}
                className={cn(
                  "text-sidebar-foreground/80 relative flex min-h-10 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors outline-none",
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring focus-visible:ring-2",
                  active &&
                    "bg-sidebar-accent text-sidebar-accent-foreground before:bg-brand font-medium before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{item.label}</span>
                {item.badge ? (
                  <span
                    data-slot="nav-badge"
                    className="bg-brand text-brand-foreground ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] leading-none font-semibold tabular-nums"
                  >
                    <span aria-hidden>{item.badge > 99 ? "99+" : item.badge}</span>
                    <span className="sr-only">{item.badge} waiting</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
