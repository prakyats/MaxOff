"use client";

import { usePathname } from "next/navigation";

import { cn } from "@/core/lib/utils";
import { ViewLink } from "@/core/ui/composites/view-link";

export type LeaveTab = { label: string; href: string };

/** Attendance & leave's two views (5B decision 2). */
export const LEAVE_TABS: readonly LeaveTab[] = [
  { label: "Leave requests", href: "/leave" },
  { label: "Attendance", href: "/leave/attendance" },
];

/** Extra work & expenses' two views (5B decision 3; Extra work since 3b.2, Expenses since 3b.3). */
export const WORK_TABS: readonly LeaveTab[] = [
  { label: "Extra work", href: "/leave/extra-work" },
  { label: "Expenses", href: "/leave/expenses" },
];

/**
 * A page's two views, each its own route (owner decision 2026-10-02: "keep the tabs under a page
 * as it is now"). `ViewLink`s: switching replaces the entry instead of adding one, so one back
 * leaves the page (ARCHITECTURE §14.2 d), and the page does not jump to the top. The cells are
 * rem-wide at least, so under large system text they wrap instead of running past the screen
 * (§14.2 i).
 */
export function LeaveTabs({ tabs, label }: { tabs: readonly LeaveTab[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label={label}
      data-slot="leave-tabs"
      className="bg-muted mb-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,4.5rem),1fr))] gap-1 rounded-lg p-1 md:inline-grid md:w-[24rem]"
    >
      {tabs.map(({ label: name, href }) => (
        <ViewLink
          key={href}
          href={href}
          scroll={false}
          aria-current={pathname === href ? "page" : undefined}
          className={cn(
            "focus-visible:ring-ring flex min-h-11 items-center justify-center rounded-md px-2 text-center text-sm font-medium outline-none select-none focus-visible:ring-2",
            pathname === href
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground active:bg-background/60",
          )}
        >
          {name}
        </ViewLink>
      ))}
    </nav>
  );
}
