import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/core/lib/utils";
import { ViewLink } from "@/core/ui/composites/view-link";
import {
  monthOf,
  nextPeriod,
  type Period,
  periodHref,
  periodLabel,
  previousPeriod,
  weekOf,
} from "@/modules/reports";

/**
 * The work report's period (6.3): Week · Month · Custom, a pager for a week or a month, and what
 * is shown. View controls: `ViewLink`s replace the entry, so one back leaves the report
 * (ARCHITECTURE §14.2 d). `period` null: the loading skeleton (the same control, nothing chosen).
 */
export function PeriodControls({ period, today }: { period: Period | null; today: string }) {
  const kinds = [
    { kind: "week", label: "Week", href: periodHref(weekOf(today as Period["from"])) },
    { kind: "month", label: "Month", href: periodHref(monthOf(today as Period["from"])) },
    {
      kind: "custom",
      label: "Custom",
      href: periodHref({ ...(period ?? weekOf(today as Period["from"])), kind: "custom" }),
    },
  ] as const;
  const before = period && period.kind !== "custom" ? previousPeriod(period) : null;
  const after = period ? nextPeriod(period, today as Period["from"]) : null;
  return (
    <div className="mb-4 flex flex-col gap-3" data-slot="report-period">
      <nav
        aria-label="Report period"
        className="bg-muted grid grid-cols-3 gap-1 rounded-lg p-1 md:inline-grid md:w-80"
      >
        {kinds.map(({ kind, label, href }) => (
          <ViewLink
            key={kind}
            href={href}
            scroll={false}
            aria-current={period?.kind === kind ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring flex min-h-11 items-center justify-center rounded-md px-2 text-center text-sm font-medium outline-none select-none focus-visible:ring-2",
              period?.kind === kind
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground active:bg-background/60",
            )}
          >
            {label}
          </ViewLink>
        ))}
      </nav>
      {period === null ? (
        // The pager's row while loading (a week opens by default), so nothing moves.
        <div aria-hidden className="min-h-11" />
      ) : period.kind !== "custom" ? (
        <div className="flex min-h-11 items-center justify-between gap-2 md:justify-start">
          {before ? (
            <ViewLink
              href={periodHref(before)}
              scroll={false}
              icon
              aria-label={period.kind === "week" ? "Previous week" : "Previous month"}
              className="text-muted-foreground hover:text-foreground flex size-11 items-center justify-center rounded-md"
            >
              <ChevronLeftIcon className="size-4" aria-hidden />
            </ViewLink>
          ) : null}
          <span className="text-sm font-medium" data-slot="report-period-label">
            {periodLabel(period, today as Period["from"])}
          </span>
          {after ? (
            <ViewLink
              href={periodHref(after)}
              scroll={false}
              icon
              aria-label={period.kind === "week" ? "Next week" : "Next month"}
              className="text-muted-foreground hover:text-foreground flex size-11 items-center justify-center rounded-md"
            >
              <ChevronRightIcon className="size-4" aria-hidden />
            </ViewLink>
          ) : (
            <span className="size-11" aria-hidden />
          )}
        </div>
      ) : null}
    </div>
  );
}
