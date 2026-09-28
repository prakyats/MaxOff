"use client";

import { usePathname } from "next/navigation";

import { cn } from "@/core/lib/utils";
import { ViewLink } from "@/core/ui/composites/view-link";

/**
 * The views of a person's page for the Owner (3.4): Profile, their leave requests and
 * attendance (2.4), and their month (3b.4). Four in a row at the default text size; the cells are
 * rem-wide at least, so under large system text they wrap to two rows (§14.2 i). `ViewLink`s: switching replaces the entry, so one back from any view returns
 * to where the Owner came from (People, the board, Approvals), whatever they switched to
 * (ARCHITECTURE §14.2 d).
 */
export function PersonTabs({ memberId }: { memberId: string }) {
  const pathname = usePathname();
  const tabs = [
    { label: "Profile", href: `/people/${memberId}` },
    { label: "Leave", href: `/people/${memberId}/leave` },
    { label: "Attendance", href: `/people/${memberId}/attendance` },
    { label: "Month", href: `/people/${memberId}/month` },
  ];
  return (
    <nav
      aria-label="Person"
      data-slot="person-tabs"
      className="bg-muted mb-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,4.5rem),1fr))] gap-1 rounded-lg p-1 md:inline-grid md:w-[32rem]"
    >
      {tabs.map(({ label, href }) => (
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
