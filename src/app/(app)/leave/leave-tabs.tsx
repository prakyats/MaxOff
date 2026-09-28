"use client";

import { usePathname } from "next/navigation";

import { cn } from "@/core/lib/utils";
import { ViewLink } from "@/core/ui/composites/view-link";

const TABS = [
  { label: "Leave requests", href: "/leave" },
  { label: "Attendance", href: "/leave/attendance" },
  { label: "Extra work", href: "/leave/extra-work" },
  { label: "Expenses", href: "/leave/expenses" },
] as const;

/**
 * The four views of the screen (Extra work since 3b.2, Expenses since 3b.3). `ViewLink`s:
 * switching replaces the entry instead of adding one, so one back leaves the page (ARCHITECTURE
 * §14.2 d), and the page does not jump to the top. Four in a row at the default text size; the
 * cells are rem-wide at least, so under large system text they wrap to two rows instead of
 * running past the screen (§14.2 i).
 */
export function LeaveTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Attendance and leave"
      data-slot="leave-tabs"
      className="bg-muted mb-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,4.5rem),1fr))] gap-1 rounded-lg p-1 md:inline-grid md:w-[36rem]"
    >
      {TABS.map(({ label, href }) => (
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
          {label}
        </ViewLink>
      ))}
    </nav>
  );
}
