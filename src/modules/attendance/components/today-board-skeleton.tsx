import { Skeleton } from "@/core/ui/primitives/skeleton";

/*
 * The board's skeletons in a file of their own (v7.0): the tap drawings load them without the
 * board's live parts (its links and the Stay until button), which would otherwise follow them
 * into other screens' first-load JavaScript. No domain import either (the review rules, which
 * Approvals loads, would no longer fold into its screen): the strip's count of cells is
 * `TODAY_STRIP_CELLS`, which a unit test keeps equal to `TODAY_STRIP_COUNTS`.
 */

/** How many counts the Owner's strip shows (`TODAY_STRIP_COUNTS`, the domain's list of them). */
export const TODAY_STRIP_CELLS = 4;

/**
 * The strip: the four counts in one row (owner 2026-10-09). A container query, in rem, so it holds
 * four only while four fit their labels on one line: a 375px phone at the default text size has
 * room (21rem of 21.4rem); at large system text (§14.2 i) it is two rows of two, never a label
 * wrapped or cut.
 */
export const COUNT_GRID =
  "border-border bg-card grid grid-cols-2 gap-1 rounded-lg border p-1 @min-[21rem]:grid-cols-4";
/** One count: the dot and the number (20 px, one step up: PP-today-3) on a 28px line, the label
 * under it; 44px tall at least. */
export const COUNT_CELL =
  "focus-visible:ring-ring flex min-h-11 min-w-0 flex-col justify-center rounded-md px-1 py-1 outline-none focus-visible:ring-2";

export function PersonTodayLineSkeleton() {
  return (
    <div
      aria-hidden
      data-slot="loading-person-today"
      className="mb-4 flex min-h-6 items-center gap-2"
    >
      <Skeleton className="h-3.5 w-12" />
      <Skeleton className="h-3.5 w-40" />
    </div>
  );
}

/**
 * The Owner's attendance section while Today loads: its heading and the strip of four, the same
 * container query and cells. The red lines under it are not drawn: each shows only above zero and
 * nothing the loading screen traces sits under them.
 */
export function TodayCardSkeleton() {
  return (
    <div
      aria-hidden
      data-slot="loading-today-card"
      className="@container flex min-w-0 flex-col gap-2"
    >
      <div className="flex h-5 items-center">
        <Skeleton className="h-4 w-24" />
      </div>
      <div className={COUNT_GRID}>
        {Array.from({ length: TODAY_STRIP_CELLS }, (_, cell) => (
          <div key={cell} className={COUNT_CELL}>
            <div className="flex h-7 items-center gap-1.5">
              <Skeleton className="size-2 rounded-full" />
              <Skeleton className="h-6 w-6" />
            </div>
            <div className="flex h-4 items-center">
              <Skeleton className="h-3 w-12 max-w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
