import { ListRowSkeleton } from "@/core/ui/composites/list-row-skeleton";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/*
 * A task row's skeletons in a file of their own (v7.0): the tap drawings load them without the
 * row itself, whose module every list screen loads (a drawing's export there would join their
 * first load).
 */

/**
 * The skeleton of a `TaskRowList` (ARCHITECTURE §14.1: a skeleton traces its screen): each row the
 * height, padding and lines of a `TaskRow` (`ListRowSkeleton`: the title with a chip and › on its
 * line, the meta line under both), `max-w-full` on the bars so they survive 200% text.
 */
export function TaskRowsSkeleton({
  rows,
  label,
  notes = 0,
  avatars = false,
}: {
  rows: number;
  label: string;
  /** How many rows (the first ones) carry the third line ("Asha hasn't noted it · 9 h"). */
  notes?: number;
  /** Rows led by the primary owner's photo (`TaskRow`'s `person`). */
  avatars?: boolean;
}) {
  return (
    <ul
      aria-hidden
      data-slot="loading-task-rows"
      aria-label={label}
      className="border-border divide-border bg-card shadow-raised divide-y overflow-hidden rounded-lg border"
    >
      {Array.from({ length: rows }, (_, index) => (
        <ListRowSkeleton key={index} note={index < notes} lead={avatars} />
      ))}
    </ul>
  );
}

/** A section heading's skeleton ("Needs you · 2"), the height of the `h2` above a list. */
export function TaskSectionHeadingSkeleton() {
  return (
    <div className="flex h-5 min-w-0 items-center">
      <Skeleton className="h-4 w-28 max-w-full" />
    </div>
  );
}
