import { cn } from "@/core/lib/utils";
import { PageHeader } from "@/core/ui/composites/page-header";
import {
  CARD_ROW_MIN_H,
  CARD_ROW_PADDING,
  CARD_ROW_TITLE,
  CARD_ROW_TRAILING,
} from "@/core/ui/composites/row-metrics";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * The team's month (3b.4): the header with its back, the month switcher row, then one row per
 * person traced as `TeamMonthList` draws it (3b review): the name over the days line on the
 * left, the four month counts (v1.9 W4), the unpaid figure and the chevron on the right. A row
 * with days waiting adds one line.
 */
export default function Loading() {
  return (
    <>
      <PageHeader back={{ href: "/reports", label: "Reports" }} title="Month" />
      <div
        data-slot="loading-leave-pager"
        aria-hidden
        className="mb-3 flex min-h-11 items-center justify-between gap-2"
      >
        <Skeleton className="size-11 rounded-md md:size-8" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="size-11 rounded-md md:size-8" />
      </div>
      <div>
        <ul
          aria-hidden
          data-slot="loading-team-month"
          className="border-border divide-border bg-card shadow-raised divide-y rounded-lg border"
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <li
              key={i}
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-1",
                CARD_ROW_MIN_H,
                CARD_ROW_PADDING,
              )}
            >
              <span className={cn("flex flex-col gap-1.5", CARD_ROW_TITLE)}>
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3.5 w-3/4" />
              </span>
              {/* v1.9 W4: the four month counts, two rows of two on a phone, four labelled
                  columns on a laptop (`MonthHoursFigures`). */}
              <span className="order-last grid basis-full grid-cols-2 gap-x-4 gap-y-1 md:order-none md:basis-auto md:grid-cols-4 md:gap-x-3">
                {[0, 1, 2, 3].map((cell) => (
                  <span
                    key={cell}
                    className="flex h-5 items-center justify-between gap-2 md:h-auto md:w-28 md:flex-col md:items-end md:gap-1"
                  >
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-3.5 w-4" />
                  </span>
                ))}
              </span>
              <span className={cn("flex items-center gap-2", CARD_ROW_TRAILING)}>
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="size-4" />
              </span>
            </li>
          ))}
        </ul>
        <span className="sr-only">Loading the team&apos;s month</span>
      </div>
    </>
  );
}
