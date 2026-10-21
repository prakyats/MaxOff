import { cn } from "@/core/lib/utils";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "./row-metrics";

/**
 * The Settings list shapes (`list-rows.tsx`) as their loading screens trace them (ARCHITECTURE
 * §14.1). Server-rendered: no JavaScript.
 */

/** `ListHeading`: a `text-sm` title line, and its Add button when it has one. */
export function ListHeadingSkeleton({
  titleWidth = "w-28",
  addWidth,
}: {
  titleWidth?: string;
  /** The Add button's width ("w-32"); absent for a heading without one. */
  addWidth?: string;
}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3">
      <span className="flex h-5 items-center">
        <Skeleton className={cn("h-3.5", titleWidth)} />
      </span>
      {addWidth ? (
        <Skeleton className={cn("rounded-control ml-auto h-11 shrink-0 md:h-8", addWidth)} />
      ) : null}
    </div>
  );
}

/**
 * `ListRowActions`: the phone's one 44 px ⋯, and from `md` up one 32 px icon per action (`icons`:
 * 4 with Move up/down, Edit and Delete; 2 without the moves; 0 for a row the viewer can't edit),
 * after the labelled Preview at every width when the row has one (`preview`, templates).
 */
export function ListRowActionsSkeleton({
  icons,
  preview = false,
}: {
  icons: number;
  preview?: boolean;
}) {
  if (icons === 0 && !preview) return null;
  return (
    <div className={cn("flex items-center", CARD_ROW_TRAILING)}>
      {preview ? <Skeleton className="rounded-control h-11 w-24" /> : null}
      {Array.from({ length: icons }, (_, i) => (
        <Skeleton key={i} className="rounded-control hidden size-8 md:block" />
      ))}
      {icons > 0 ? <Skeleton className="rounded-control size-11 md:hidden" /> : null}
    </div>
  );
}

/**
 * A bordered list of 56 px Settings rows: the name (and its meta line, `subtitle`) on the left,
 * `ListRowActions` on the right.
 */
export function ListRowsSkeleton({
  rows,
  icons,
  subtitle = false,
  preview = false,
}: {
  rows: number;
  icons: number;
  subtitle?: boolean;
  /** Each row starts its actions with a labelled Preview (templates). */
  preview?: boolean;
}) {
  return (
    <ul aria-hidden className="border-border divide-border divide-y rounded-lg border">
      {Array.from({ length: rows }, (_, row) => (
        <li
          key={row}
          className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4"
        >
          <div className={cn("flex min-w-0 flex-col gap-1.5", CARD_ROW_TITLE)}>
            <Skeleton className="h-4 w-32" />
            {subtitle ? <Skeleton className="h-3 w-44 max-w-full" /> : null}
          </div>
          <ListRowActionsSkeleton icons={icons} preview={preview} />
        </li>
      ))}
    </ul>
  );
}
