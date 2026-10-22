import { ChevronRightIcon, MessageCircleIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "@/core/ui/composites/row-metrics";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * **The one row anatomy** (DESIGN.md §Decisions, FINAL 5; V5b). Every list row in the app:
 *
 *   [title · chat count]                    [chips] [⋯] [›]
 *   [muted meta line]
 *   [optional note line]
 *
 * - **The title** is one line with an ellipsis **only when the row opens** (the opened view shows
 *   the full text: the owner's truncation rule); a row that opens nothing wraps its title in full.
 *   The meta line follows the same rule.
 * - **The chat count** (`ChatCount`) is a small muted badge **beside the title**, never among the
 *   chips.
 * - **On the right:** the chips (`StatusBadge`s: overdue and due are chips too), then ⋯ when the
 *   row has actions, then › when it opens.
 * - **The whole row opens** (`href`, a drill-down; or `onOpen`, a sheet): the link is stretched
 *   over the row, so a tap anywhere but ⋯ opens it, and ⋯ stays its own 44 px control.
 * - **Large text** (§14.2 i): the right side drops under the title, right-aligned (`CARD_ROW_*`).
 *
 * Rows go in a `ListRows` group (one bordered, raised card, rows divided). `ListRowSkeleton`
 * traces it. A server component unless its caller passes `onOpen`.
 */
export type ListRowProps = {
  title: ReactNode;
  /** Who · when: "PShetty · due Mon 19 Oct, 6:00 pm". Muted, 12 px. */
  meta?: ReactNode;
  /** A third line that says why the row is here; it wraps (a risk's plain-text reason). */
  note?: ReactNode;
  /** Beside the title: `<ChatCount count={n} />`. */
  titleBadge?: ReactNode;
  /** The status chips, in order (`StatusBadge`). */
  chips?: ReactNode;
  /** The row's ⋯ (a menu trigger), drawn before ›. */
  actions?: ReactNode;
  /** A drill-down: the row is a `DrillLink` to here (§14.2 b). */
  href?: string;
  /** Opens a sheet or dialog instead (a client caller). */
  onOpen?: () => void;
  /** The opener's accessible name when the title alone is not enough. */
  openLabel?: string;
  className?: string;
  /** The `<li>`'s `data-slot`, for a screen's specs ("task-row"). */
  slot?: string;
  /** More `data-*` attributes on the `<li>` (`{ "data-task": id }`), for a screen's specs. */
  data?: { [key: `data-${string}`]: string | undefined };
};

/** What a row draws on its right and whether its text is cut (pure; `list-row.test.tsx`). */
export function rowParts({ opens, actions }: { opens: boolean; actions: boolean }): {
  chevron: boolean;
  menu: boolean;
  truncate: boolean;
} {
  return { chevron: opens, menu: actions, truncate: opens };
}

export function ListRow({
  title,
  meta,
  note,
  titleBadge,
  chips,
  actions,
  href,
  onOpen,
  openLabel,
  className,
  slot = "list-row",
  data,
}: ListRowProps) {
  const opens = href !== undefined || onOpen !== undefined;
  const parts = rowParts({ opens, actions: actions !== undefined && actions !== null });
  const cut = parts.truncate ? "truncate" : "break-words";
  // The stretched opener: its ::after covers the row, so the whole row is one target.
  const opener =
    "focus-visible:ring-ring min-w-0 text-left outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset";
  const text = (
    <>
      <span className="flex min-w-0 items-center gap-1.5">
        <span data-slot="list-row-title" className={cn("min-w-0 text-sm font-medium", cut)}>
          {title}
        </span>
        {titleBadge}
      </span>
      {meta ? (
        <span data-slot="list-row-meta" className={cn("text-muted-foreground text-xs", cut)}>
          {meta}
        </span>
      ) : null}
    </>
  );
  return (
    <li
      {...data}
      data-slot={slot}
      data-opens={opens ? "" : undefined}
      className={cn(
        "relative flex min-h-16 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3",
        className,
      )}
    >
      <span className={cn("flex flex-col gap-0.5", CARD_ROW_TITLE)}>
        {href !== undefined ? (
          <DrillLink
            href={href}
            data-slot="list-row-opener"
            className={cn(opener, "flex flex-col gap-0.5")}
            aria-label={openLabel}
          >
            {text}
          </DrillLink>
        ) : onOpen !== undefined ? (
          <button
            type="button"
            onClick={onOpen}
            data-slot="list-row-opener"
            className={cn(opener, "pressable-row flex flex-col gap-0.5")}
            aria-label={openLabel}
          >
            {text}
          </button>
        ) : (
          text
        )}
        {note ? (
          <span data-slot="list-row-note" className="text-xs break-words">
            {note}
          </span>
        ) : null}
      </span>
      {chips || parts.menu || parts.chevron ? (
        <span
          className={cn(
            "flex max-w-full flex-wrap items-center justify-end gap-x-2 gap-y-1",
            CARD_ROW_TRAILING,
          )}
        >
          {chips ? (
            <span data-slot="list-row-chips" className="flex flex-wrap items-center gap-1.5">
              {chips}
            </span>
          ) : null}
          {parts.menu ? (
            <span data-slot="list-row-actions" className="relative z-10 -my-2 flex">
              {actions}
            </span>
          ) : null}
          {parts.chevron ? (
            <ChevronRightIcon
              aria-hidden
              data-slot="list-row-open"
              className="text-faint size-4 shrink-0"
            />
          ) : null}
        </span>
      ) : null}
    </li>
  );
}

/** A group of `ListRow`s: one bordered, raised card, rows divided (FINAL 2: no card in a card). */
export function ListRows({
  label,
  slot = "list-rows",
  className,
  children,
}: {
  label: string;
  slot?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ul
      aria-label={label}
      data-slot={slot}
      className={cn(
        "border-border divide-border bg-card shadow-raised divide-y overflow-hidden rounded-lg border",
        className,
      )}
    >
      {children}
    </ul>
  );
}

/** "3 new comments", "1 new comment". */
export function chatCountLabel(count: number): string {
  return `${count} new ${count === 1 ? "comment" : "comments"}`;
}

/**
 * The chat count beside a row's title (FINAL 5, PP-admin-6, PP-crew-6): a small muted badge, a
 * bubble and the number, spoken as "2 new comments". Never red, never among the chips. Nothing
 * when there is nothing new.
 */
export function ChatCount({
  count,
  label,
  slot = "chat-count",
  className,
}: {
  count: number;
  label?: string;
  /** The badge's `data-slot`, when a screen's specs already name it ("task-unread"). */
  slot?: string;
  className?: string | undefined;
}) {
  if (count <= 0) return null;
  return (
    <span
      data-slot={slot}
      className={cn(
        "bg-muted text-muted-foreground inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 text-xs leading-5 font-medium",
        className,
      )}
    >
      <MessageCircleIcon aria-hidden className="size-3" />
      <span aria-hidden>{count > 99 ? "99+" : count}</span>
      <span className="sr-only">{label ?? chatCountLabel(count)}</span>
    </span>
  );
}

/**
 * A `ListRows` group's skeleton (§14.1: a skeleton traces its screen): each row the height and
 * padding of a `ListRow`, the title and meta bars on the left, a chip and › on the right.
 */
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
        <li
          key={index}
          className="flex min-h-16 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
        >
          <span className={cn("flex flex-col gap-0.5", CARD_ROW_TITLE)}>
            <span className="flex h-5 min-w-0 items-center">
              <Skeleton className="h-4 w-44 max-w-full" />
            </span>
            <span className="flex h-4 min-w-0 items-center">
              <Skeleton className="h-3 w-56 max-w-full" />
            </span>
          </span>
          <span className={cn("flex items-center gap-2", CARD_ROW_TRAILING)}>
            {chips ? <Skeleton className="h-5 w-20 rounded-full" /> : null}
            {chevron ? <Skeleton className="size-4" /> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
