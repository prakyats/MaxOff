"use client";

import { usePathname } from "next/navigation";

import { cn } from "@/core/lib/utils";
import { ViewLink } from "@/core/ui/composites/view-link";

/**
 * The views of a client's page (3.4, PRODUCT §4.4 "page sections"): Overview (details,
 * contacts, notes), Brand, Activity. Projects and Staff tasks join with phases 4 and 5.
 * `ViewLink`s: a switch replaces the entry, so one back from any view returns to the list
 * (ARCHITECTURE §14.2 d).
 */
export function ClientTabs({ clientId }: { clientId: string }) {
  const pathname = usePathname();
  const tabs = [
    { label: "Overview", href: `/clients/${clientId}` },
    { label: "Brand", href: `/clients/${clientId}/brand` },
    { label: "Activity", href: `/clients/${clientId}/activity` },
  ];
  return (
    <nav
      aria-label="Client"
      data-slot="client-tabs"
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
