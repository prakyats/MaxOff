"use client";

import { usePathname } from "next/navigation";

import { cn } from "@/core/lib/utils";
import { ViewLink } from "@/core/ui/composites/view-link";

/**
 * The two views of a person's history (task 2.4), like the member's own /leave. `ViewLink`s:
 * switching replaces the entry, so one back from either view returns to where the Owner came
 * from (the board or People), whatever they switched to (ARCHITECTURE §14.2 d).
 */
export function PersonTabs({ memberId }: { memberId: string }) {
  const pathname = usePathname();
  const tabs = [
    { label: "Leave requests", href: `/people/${memberId}` },
    { label: "Attendance", href: `/people/${memberId}/attendance` },
  ];
  return (
    <nav
      aria-label="Attendance and leave"
      data-slot="person-tabs"
      className="bg-muted mb-4 grid grid-cols-2 gap-1 rounded-lg p-1 md:inline-grid md:w-80"
    >
      {tabs.map(({ label, href }) => (
        <ViewLink
          key={href}
          href={href}
          scroll={false}
          aria-current={pathname === href ? "page" : undefined}
          className={cn(
            "focus-visible:ring-ring flex min-h-11 items-center justify-center rounded-md px-3 text-sm font-medium outline-none select-none focus-visible:ring-2",
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
