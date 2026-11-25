import { cn } from "@/core/lib/utils";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/*
 * A `ListRow`'s skeletons in a file of their own (v7.0): the tap drawings load them without the
 * row itself, whose module every list screen loads (a drawing's export there would join their
 * first load). The row's grid classes are `list-row.tsx`'s; a unit test keeps the two equal.
 */

/** `ListRow`'s grid (`ROW_GRID` in `list-row.tsx`). */
export const SKELETON_ROW_GRID =
  "grid min-w-0 grid-cols-[minmax(6rem,1fr)_auto] content-center items-center gap-x-3 gap-y-0.5";
/** `ListRow`'s narrow trailing part (`NARROW_TRAILING`). */
export const SKELETON_NARROW_TRAILING = "@max-[18rem]/row:contents";
/** `ListRow`'s narrow chips (`NARROW_CHIPS`). */
export const SKELETON_NARROW_CHIPS =
  "@max-[18rem]/row:col-span-full @max-[18rem]/row:row-start-3 @max-[18rem]/row:mt-0.5 @max-[18rem]/row:flex-wrap @max-[18rem]/row:justify-self-end";

/**
 * One `ListRow`'s skeleton (§14.1: a skeleton traces its screen): the row's grid, the title bar
 * with a chip and › on its line, the meta bar under both, and an optional third line.
 */
export function ListRowSkeleton({
  chips = true,
  chevron = true,
  note = false,
  lead = false,
}: {
  chips?: boolean;
  chevron?: boolean;
  note?: boolean;
  /** The row's `lead`: a 20 px photo before the title. */
  lead?: boolean;
}) {
  return (
    <li className="@container/row relative flex min-h-16 min-w-0 flex-col px-4 py-3">
      <div className={cn(SKELETON_ROW_GRID, "flex-1")}>
        <span className="col-start-1 row-start-1 flex h-5 min-w-0 items-center gap-1.5">
          {lead ? <Skeleton className="size-5 shrink-0 rounded-full" /> : null}
          <Skeleton className="h-4 w-44 max-w-full" />
        </span>
        {chips || chevron ? (
          <span
            className={cn(
              "col-start-2 row-start-1 flex min-w-0 items-center justify-end gap-2",
              SKELETON_NARROW_TRAILING,
            )}
          >
            {chips ? (
              <span className={cn("flex min-w-0 items-center", SKELETON_NARROW_CHIPS)}>
                <Skeleton className="h-5 w-20 max-w-full rounded-full" />
              </span>
            ) : null}
            {chevron ? (
              <span className="col-start-2 row-start-1 flex shrink-0 items-center justify-end">
                <Skeleton className="size-4" />
              </span>
            ) : null}
          </span>
        ) : null}
        <span className="col-span-full row-start-2 flex h-4 min-w-0 items-center">
          <Skeleton className="h-3 w-56 max-w-full" />
        </span>
        {note ? (
          <span className="col-span-full row-start-3 flex h-4 min-w-0 items-center @max-[18rem]/row:row-start-4">
            <Skeleton className="h-3 w-40 max-w-full" />
          </span>
        ) : null}
      </div>
    </li>
  );
}

/** A `ListRows` group's skeleton: `rows` of `ListRowSkeleton` in the group's card. */
export function ListRowsSkeleton({
  rows,
  chips = true,
  chevron = true,
}: {
  rows: number;
  chips?: boolean;
  chevron?: boolean;
}) {
  return (
    <ul
      aria-hidden
      data-slot="loading-list-rows"
      className="border-border divide-border bg-card shadow-raised divide-y overflow-hidden rounded-lg border"
    >
      {Array.from({ length: rows }, (_, index) => (
        <ListRowSkeleton key={index} chips={chips} chevron={chevron} />
      ))}
    </ul>
  );
}
