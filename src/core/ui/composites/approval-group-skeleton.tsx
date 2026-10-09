import { cn } from "@/core/lib/utils";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { APPROVAL_ROW_MIN_H, LIST_ROW_MIN_H } from "./row-metrics";

/**
 * Compact approval rows (`ApprovalGroup` with `layout="rows"`, the Owner's Today) while the screen
 * loads: the same list box, the same row height, the kind label and title on the first line, the
 * two meta lines (what and when; how long it has waited) under it, and the one outlined button
 * beside them (44px on a phone, 32px from `md`).
 */
export function ApprovalRowsSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <ul
      aria-hidden
      data-slot="loading-approval-rows"
      className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border"
    >
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className={cn("flex min-w-0 items-center gap-3 pr-4", APPROVAL_ROW_MIN_H)}>
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-2 pl-4">
            <div className="flex h-5 min-w-0 items-center gap-2">
              <Skeleton className="h-3 w-12 shrink-0" />
              <Skeleton className="h-3.5 w-32 max-w-full" />
            </div>
            <div className="flex h-4 min-w-0 items-center">
              <Skeleton className="h-3 w-40 max-w-full" />
            </div>
            <div className="flex h-4 min-w-0 items-center">
              <Skeleton className="h-3 w-20 max-w-full" />
            </div>
          </div>
          <Skeleton className="h-11 w-20 shrink-0 rounded-lg md:h-8" />
        </li>
      ))}
    </ul>
  );
}

// Its own file, with no "use client" (6.0): a loading screen that draws it must not pull the
// group's client code (the confirmation, the dialogs) into its route's first load.
/**
 * `ApprovalGroup` while the screen loads (ARCHITECTURE §14.1): the same header row, the same
 * two-line rows and the same two buttons, stacked under the text on a phone and beside it from
 * `md` up, so nothing moves when the data arrives.
 */
export function ApprovalGroupSkeleton({
  rows = 2,
  bulk = true,
}: {
  rows?: number;
  /** The heading's "Approve all N" (none in the Owner's Today preview, 6.2). */
  bulk?: boolean;
}) {
  return (
    <div aria-hidden data-slot="loading-approval-group">
      <div className="mb-2 flex min-h-11 items-center justify-between gap-3">
        <Skeleton className="h-3.5 w-24" />
        {bulk ? <Skeleton className="h-11 w-28 rounded-md md:h-7" /> : null}
      </div>
      <ul className="border-border divide-border bg-card divide-y rounded-lg border">
        {Array.from({ length: rows }, (_, i) => (
          <li
            key={i}
            className={cn(
              "flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:gap-4",
              LIST_ROW_MIN_H,
            )}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3.5 w-1/3" />
            </div>
            <div className="flex shrink-0 gap-2 *:flex-1 md:*:flex-none">
              <Skeleton className="h-11 rounded-md md:h-8 md:w-20" />
              <Skeleton className="h-11 rounded-md md:h-8 md:w-20" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
