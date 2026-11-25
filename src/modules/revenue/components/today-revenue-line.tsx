import { ChevronRightIcon } from "lucide-react";

import { captureException } from "@/core/observability/capture";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { type MonthTotals, todayRevenueLine } from "../domain/today";

/** The line's box, shared with its fallback so the line replaces it in place (§14.1). */
const LINE_CARD =
  "border-border bg-card shadow-raised flex min-h-16 items-center gap-3 overflow-hidden rounded-lg border px-4 py-2 text-sm";
const LINE_LINK =
  "pressable text-foreground hover:bg-muted focus-visible:ring-ring rounded-control flex min-h-11 shrink-0 items-center gap-1 px-2 font-medium outline-none focus-visible:ring-2";

/**
 * The Owner's **Today line** (v2.5 "Revenue every day", kickoff 9 R5): the last thing on Today.
 * "November · ₹ ••• achieved of ₹ ••• · 2 not priced", the amounts masked until the Owner taps
 * the line, then the real figures; "Open Revenue" beside it. The tap is a view control: a native
 * `<details>` (no history entry, nothing kept, no client code at all, so `/today`'s first-load
 * JS is unchanged); a second tap masks them again.
 *
 * Today renders this, and starts its read, only for a viewer with `finance.view` (the Owner); an
 * Admin's Today has neither the line nor its request (invariant 2). It streams in its own
 * `<Suspense>` after the page, behind `TodayRevenueLineSkeleton`. A read that fails draws nothing
 * (Today shows exceptions, and this is not one) and is reported once through the scrubber.
 */
export async function TodayRevenueLine({ read }: { read: Promise<MonthTotals> }) {
  let totals: MonthTotals;
  try {
    totals = await read;
  } catch (error) {
    captureException(error);
    return null;
  }
  return (
    <section aria-label="Revenue this month" data-slot="today-revenue" className={LINE_CARD}>
      <details className="group/revenue min-w-0 flex-1" data-slot="today-revenue-line">
        <summary
          className="focus-visible:ring-ring rounded-control flex min-h-11 cursor-pointer list-none items-center outline-none select-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden"
          data-slot="today-revenue-toggle"
        >
          <span
            className="break-words tabular-nums group-open/revenue:hidden"
            data-slot="today-revenue-masked"
          >
            {todayRevenueLine(totals, { masked: true })}
            <span className="sr-only"> (tap to show the amounts)</span>
          </span>
          <span
            className="hidden break-words tabular-nums group-open/revenue:inline"
            data-slot="today-revenue-figures"
          >
            {todayRevenueLine(totals, { masked: false })}
            <span className="sr-only"> (tap to hide the amounts)</span>
          </span>
        </summary>
      </details>
      <DrillLink href="/reports/revenue" className={LINE_LINK} data-slot="today-revenue-open">
        Open Revenue
        <ChevronRightIcon aria-hidden className="text-muted-foreground size-4" />
      </DrillLink>
    </section>
  );
}

/** The Today line while its read is on its way: the same box, one line of text and the link. */
export function TodayRevenueLineSkeleton() {
  return (
    <div aria-hidden className={LINE_CARD} data-slot="today-revenue-skeleton">
      <span className="flex min-h-11 min-w-0 flex-1 items-center">
        <Skeleton className="h-3.5 w-3/4" />
      </span>
      <span className="flex min-h-11 shrink-0 items-center px-2">
        <Skeleton className="h-3.5 w-24" />
      </span>
    </div>
  );
}
