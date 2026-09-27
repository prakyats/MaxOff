"use client";

import { usePathname } from "next/navigation";

import { cn } from "@/core/lib/utils";
import { ViewLink } from "@/core/ui/composites/view-link";

/**
 * The views of a person's page for the Owner (3.4): Profile, and their leave requests and
 * attendance (2.4). `ViewLink`s: switching replaces the entry, so one back from any view returns
 * to where the Owner came from (People, the board, Approvals), whatever they switched to
 * (ARCHITECTURE §14.2 d).
 */
export function PersonTabs({ memberId }: { memberId: string }) {
  const pathname = usePathname();
  const tabs = [
    { label: "Profile", href: `/people/${memberId}` },
    { label: "Leave", href: `/people/${memberId}/leave` },
    { label: "Attendance", href: `/people/${memberId}/attendance` },
  ];
  return (
    <nav
      aria-label="Person"
      data-slot="person-tabs"
      className="bg-muted mb-4 grid grid-cols-3 gap-1 rounded-lg p-1 md:inline-grid md:w-96"
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
