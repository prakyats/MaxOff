import { cn } from "@/core/lib/utils";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { LIST_ROW_MIN_H } from "./row-metrics";

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
