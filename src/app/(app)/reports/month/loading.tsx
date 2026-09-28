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
 * left, the unpaid figure and the chevron on the right. A row with days waiting adds one line.
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
      <div className="md:max-w-3xl">
        <ul
          aria-hidden
          data-slot="loading-team-month"
          className="border-border divide-border bg-card divide-y rounded-lg border"
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
