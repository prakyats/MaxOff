import type { ReactNode } from "react";

import { ListRow, ListRowSkeleton } from "@/core/ui/composites/list-row";
import { type StatusTone, StatusBadge } from "@/core/ui/composites/status-badge";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { UnreadMarker } from "./unread-marker";

/**
 * One task in a list (4.5): the Tasks tab's groups, "Needs you" and the open tasks, Today and My
 * Day. **The one row anatomy** (`ListRow`, DESIGN §Decisions FINAL 5; V5b major change 9): the
 * title on one line (the task's page shows it in full) with the unread comments as a small muted
 * badge beside it (PP-admin-6, PP-crew-6), the deadline and whose it is on the muted meta line,
 * at most one line that says why it is here ("for Asha", "Asha hasn't noted it · 9 h"), then on
 * the right the chips (the reason, "Overdue" red or "Note it" amber, then the state; PP-tasks-2,
 * PP-admin-13) and ›. A drill-down to the task's page (ARCHITECTURE §14.2 b). A server component:
 * it draws nothing a phone has to hydrate.
 */
export function TaskRow({
  id,
  title,
  meta,
  status,
  statusLabel,
  tone,
  flag,
  note,
  unread = 0,
}: {
  id: string;
  title: string;
  /** "Due Thu 1 Oct, 6:00 pm · Asha · Sharma Weddings". */
  meta: string;
  /** The task state (the chip's tone) and its word. */
  status: string;
  statusLabel: string;
  tone?: StatusTone;
  /** A chip before the state: "Overdue", "Note it", "High". */
  flag?: { label: string; tone: StatusTone } | null;
  /** Why the task is in this list, one line. */
  note?: ReactNode;
  /** The viewer's unread comments on it (`task_unread_counts()`). */
  unread?: number;
}) {
  return (
    <ListRow
      slot="task-row"
      data={{ "data-task": id }}
      href={`/tasks/${id}`}
      // Block and cut themselves: an inline span would run on past its cut parent's box, reaching
      // past the screen's edge at large text (the `expectNoHorizontalScroll` sweep).
      title={
        <span data-slot="task-row-title" className="block truncate">
          {title}
        </span>
      }
      titleBadge={<UnreadMarker count={unread} />}
      meta={
        <span data-slot="task-row-meta" className="block truncate">
          {meta}
        </span>
      }
      note={note ? <span data-slot="task-row-note">{note}</span> : undefined}
      chips={
        <>
          {flag ? <StatusBadge status={flag.label} tone={flag.tone} label={flag.label} /> : null}
          <StatusBadge status={status} label={statusLabel} {...(tone ? { tone } : {})} />
        </>
      }
    />
  );
}

/** A list of `TaskRow`s under a heading: one bordered block, rows divided (§14.1 cards). */
export function TaskRowList({
  label,
  slot,
  children,
}: {
  label: string;
  slot?: string;
  children: ReactNode;
}) {
  return (
    <ul
      aria-label={label}
      data-slot={slot ?? "task-rows"}
      className="border-border divide-border bg-card shadow-raised divide-y overflow-hidden rounded-lg border"
    >
      {children}
    </ul>
  );
}

/**
 * The skeleton of a `TaskRowList` (ARCHITECTURE §14.1: a skeleton traces its screen): each row the
 * height, padding and lines of a `TaskRow` (`ListRowSkeleton`: the title with a chip and › on its
 * line, the meta line under both), `max-w-full` on the bars so they survive 200% text.
 */
export function TaskRowsSkeleton({
  rows,
  label,
  notes = 0,
}: {
  rows: number;
  label: string;
  /** How many rows (the first ones) carry the third line ("Asha hasn't noted it · 9 h"). */
  notes?: number;
}) {
  return (
    <ul
      aria-hidden
      data-slot="loading-task-rows"
      aria-label={label}
      className="border-border divide-border bg-card shadow-raised divide-y overflow-hidden rounded-lg border"
    >
      {Array.from({ length: rows }, (_, index) => (
        <ListRowSkeleton key={index} note={index < notes} />
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
