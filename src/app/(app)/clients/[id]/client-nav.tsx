"use client";

import { usePathname } from "next/navigation";

import { cn } from "@/core/lib/utils";
import { ViewLink } from "@/core/ui/composites/view-link";

/**
 * The views of a client's page (3.4, PRODUCT §4.4 "page sections"; kickoff 7 decision 20):
 * Overview (details, contacts, notes, the line to its labelled tasks), Projects (7.3), Brand,
 * Activity. No tasks tab: the Overview's line opens All tasks filtered to the client.
 * `ViewLink`s: a switch replaces the entry, so one back from any view returns to the list
 * (ARCHITECTURE §14.2 d).
 */
export function ClientTabs({ clientId }: { clientId: string }) {
  const pathname = usePathname();
  const tabs = [
    { label: "Overview", href: `/clients/${clientId}` },
    { label: "Projects", href: `/clients/${clientId}/projects` },
    { label: "Brand", href: `/clients/${clientId}/brand` },
    { label: "Activity", href: `/clients/${clientId}/activity` },
  ];
  return (
    <nav
      aria-label="Client"
      data-slot="client-tabs"
      className="bg-muted mb-4 grid grid-cols-4 gap-1 rounded-lg p-1 md:inline-grid md:w-[32rem]"
    >
      {tabs.map(({ label, href }) => (
        <ViewLink
          key={href}
          href={href}
          scroll={false}
          aria-current={pathname === href ? "page" : undefined}
          className={cn(
            "focus-visible:ring-ring flex min-h-11 min-w-0 items-center justify-center rounded-md px-1 text-center text-sm font-medium break-words outline-none select-none focus-visible:ring-2",
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
