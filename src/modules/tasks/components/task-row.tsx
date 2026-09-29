import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "@/core/ui/composites/row-metrics";
import { type StatusTone, StatusDot } from "@/core/ui/composites/status-badge";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * One task in a list (4.5): the Tasks tab's groups, "Needs you" and the open tasks. A drill-down
 * to the task's page (ARCHITECTURE §14.2 b, it slides in the installed app), phone first: the
 * title with the state as a dot and a word (§14.1: never a badge column), the deadline and whose
 * it is on the second line, and at most one line that says why it is here ("for Asha", "Asha
 * hasn't noted it · 9 h"). Under large text the state drops under the title (`CARD_ROW_*`).
 * A server component: it draws nothing a phone has to hydrate.
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
}: {
  id: string;
  title: string;
  /** "Due Thu 1 Oct, 6:00 pm · Asha · Sharma Weddings". */
  meta: string;
  /** The task state (the dot's tone) and its word. */
  status: string;
  statusLabel: string;
  tone?: StatusTone;
  /** A second marker beside the state: "Overdue", "High". */
  flag?: { label: string; tone: StatusTone } | null;
  /** Why the task is in this list, one line. */
  note?: ReactNode;
}) {
  return (
    <li data-slot="task-row" data-task={id}>
      <DrillLink
        href={`/tasks/${id}`}
        className="focus-visible:ring-ring flex min-h-16 flex-col gap-1 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <span
            className={cn("text-sm font-medium break-words", CARD_ROW_TITLE)}
            data-slot="task-row-title"
          >
            {title}
          </span>
          {/* Two markers wrap under each other at large text rather than reach past the edge. */}
          <span
            className={cn(
              "flex max-w-full flex-wrap items-center justify-end gap-x-2 gap-y-1",
              CARD_ROW_TRAILING,
            )}
          >
            {flag ? <StatusDot status={flag.label} tone={flag.tone} label={flag.label} /> : null}
            <StatusDot status={status} label={statusLabel} {...(tone ? { tone } : {})} />
          </span>
        </span>
        <span className="text-muted-foreground text-xs break-words" data-slot="task-row-meta">
          {meta}
        </span>
        {note ? (
          <span className="text-xs font-medium break-words" data-slot="task-row-note">
            {note}
          </span>
        ) : null}
      </DrillLink>
    </li>
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
      className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border"
    >
      {children}
    </ul>
  );
}

/**
 * The skeleton of a `TaskRowList` (ARCHITECTURE §14.1: a skeleton traces its screen): each row the
 * height, padding and lines of a `TaskRow` (the title with the state dot at its right, the meta
 * line), `min-w-0` on the columns so the rem-wide bars survive 200% text (3c review).
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
      className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border"
    >
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="flex min-h-16 min-w-0 flex-col gap-1 px-4 py-3">
          <span className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <span className={cn("flex h-5 min-w-0 items-center", CARD_ROW_TITLE)}>
              <Skeleton className="h-4 w-44 max-w-full" />
            </span>
            <span className={cn("flex h-4 items-center", CARD_ROW_TRAILING)}>
              <Skeleton className="h-3 w-20" />
            </span>
          </span>
          <span className="flex h-4 min-w-0 items-center">
            <Skeleton className="h-3 w-56 max-w-full" />
          </span>
          {index < notes ? (
            <span className="flex h-4 min-w-0 items-center">
              <Skeleton className="h-3 w-40 max-w-full" />
            </span>
          ) : null}
        </li>
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
