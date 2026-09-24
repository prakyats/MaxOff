import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/core/lib/utils";
import { ViewLink } from "@/core/ui/composites/view-link";
import { Button } from "@/core/ui/primitives/button";

export type LeaveTab = "requests" | "attendance";

const TABS: { tab: LeaveTab; label: string; href: string }[] = [
  { tab: "requests", label: "Leave requests", href: "/leave" },
  { tab: "attendance", label: "Attendance", href: "/leave?tab=attendance" },
];

/**
 * The two halves of the screen as links, not client tabs: each is its own server read, and the
 * URL keeps the tab, so a reload lands where you were. They are `ViewLink`s: switching replaces
 * the entry instead of adding one, so one back leaves the page (ARCHITECTURE §14.1), and the page
 * does not jump to the top on a switch.
 */
export function LeaveTabs({ active }: { active: LeaveTab }) {
  return (
    <nav
      aria-label="Attendance and leave"
      data-slot="leave-tabs"
      className="bg-muted mb-4 grid grid-cols-2 gap-1 rounded-lg p-1 md:inline-grid md:w-80"
    >
      {TABS.map(({ tab, label, href }) => (
        <ViewLink
          key={tab}
          href={href}
          scroll={false}
          aria-current={tab === active ? "page" : undefined}
          className={cn(
            "focus-visible:ring-ring flex min-h-11 items-center justify-center rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2",
            tab === active
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </ViewLink>
      ))}
    </nav>
  );
}

/**
 * One row above either list: where you are, and the way to the previous and next page (the
 * requests) or month (the attendance). Both tabs share it, so the loading skeleton traces both.
 * The arrows are `ViewLink`s too: paging never adds history.
 */
export function LeavePager({
  label,
  previous,
  next,
  previousLabel,
  nextLabel,
}: {
  label: string;
  previous: string | null;
  next: string | null;
  previousLabel: string;
  nextLabel: string;
}) {
  return (
    <div data-slot="leave-pager" className="mb-3 flex min-h-11 items-center justify-between gap-2">
      <PagerLink href={previous} label={previousLabel}>
        <ChevronLeftIcon aria-hidden />
      </PagerLink>
      <p className="text-sm font-medium tabular-nums" aria-live="polite">
        {label}
      </p>
      <PagerLink href={next} label={nextLabel}>
        <ChevronRightIcon aria-hidden />
      </PagerLink>
    </div>
  );
}

function PagerLink({
  href,
  label,
  children,
}: {
  href: string | null;
  label: string;
  children: React.ReactNode;
}) {
  if (!href) {
    return (
      <Button variant="ghost" size="icon" disabled aria-label={label}>
        {children}
      </Button>
    );
  }
  return (
    <Button variant="ghost" size="icon" asChild>
      <ViewLink href={href} aria-label={label} icon>
        {children}
      </ViewLink>
    </Button>
  );
}
