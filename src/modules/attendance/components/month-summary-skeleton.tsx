import { Skeleton } from "@/core/ui/primitives/skeleton";

/** Which of the ten lines carry a detail line under the label (`summaryLines`). */
const LINES_WITH_DETAIL = [false, true, false, false, false, false, true, false, true, true];
/** v1.9 W4: the four month counts under them (each detail line only above zero: not reserved). */
const COUNT_LINES = 4;

/**
 * The card's tracing for `loading.tsx`: the ten lines, label left and figure right, with the
 * detail line under the four that have one. The "waiting for your review" row is data (most
 * months have none), so it is not reserved.
 */
export function MonthSummarySkeleton() {
  return (
    <div
      aria-hidden
      data-slot="loading-month-summary"
      className="border-border bg-card divide-border divide-y rounded-lg border"
    >
      {[...LINES_WITH_DETAIL, ...Array.from({ length: COUNT_LINES }, () => false)].map(
        (detail, i) => (
          <div key={i} className="flex min-h-12 items-center gap-3 px-4 py-2">
            <span className="flex flex-1 flex-col gap-1">
              <Skeleton className="h-4 w-2/5" />
              {detail ? <Skeleton className="h-3 w-3/5" /> : null}
            </span>
            <Skeleton className="h-4 w-10" />
          </div>
        ),
      )}
    </div>
  );
}
