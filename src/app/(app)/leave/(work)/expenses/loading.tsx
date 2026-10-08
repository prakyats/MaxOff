import { cn } from "@/core/lib/utils";
import { CARD_ROW_MIN_H, CARD_ROW_PADDING } from "@/core/ui/composites/row-metrics";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * The Expenses view under the layout's header and tabs (which stay painted): the "Expense claims
 * N · Add expense" row, then claim cards traced as they render: category and date over the note
 * on the left, the amount over the status dot on the right.
 */
export default function Loading() {
  return (
    <>
      <div aria-hidden className="mb-3 flex min-h-11 items-center justify-between gap-3">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-11 w-32 rounded-md" />
      </div>
      <ul
        aria-hidden
        data-slot="loading-expense-claims"
        className="border-border divide-border bg-card divide-y rounded-lg border"
      >
        {[0, 1, 2].map((i) => (
          <li key={i} className={cn("flex items-start gap-3", CARD_ROW_MIN_H, CARD_ROW_PADDING)}>
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3.5 w-3/5" />
            </span>
            <span className="flex flex-col items-end gap-1.5">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-3.5 w-28" />
            </span>
          </li>
        ))}
      </ul>
      <span className="sr-only">Loading your expense claims</span>
    </>
  );
}
