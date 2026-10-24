import { ChevronRightIcon, MessageCircleIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";
import { DrillLink } from "@/core/ui/composites/drill-link";
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
  /**
   * Before the title, on its line: the person's 20 px photo (`PersonAvatar`, decorative: the meta
   * line names them; #89). The title line keeps its height.
   */
  lead?: ReactNode;
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

/**
 * The row's grid (the design gate's follow-up, 23 Oct): the title line holds the title (at least
 * 6rem, the rest of the width once the chips have theirs) and, on its right, the chips, ⋯ and ›;
 * the meta line spans the whole row under both, so a due time is never cut by the chips. Where
 * the row opens, the chips keep to one line and shrink, cutting their own words (the truncation
 * rule: the opened view shows the state in full). A row whose content is narrower than 18rem
 * (large system text, §14.2 i, or a narrow column; a 375 px phone gives 311 px, 19.4rem) moves
 * the chips under the meta line, right-aligned and whole, and keeps ⋯ and › on the title line.
 */
const ROW_GRID =
  "grid min-w-0 grid-cols-[minmax(6rem,1fr)_auto] content-center items-center gap-x-3 gap-y-0.5";
/** Content narrower than 18rem: the chips leave the title line for a line of their own. */
const NARROW_TRAILING = "@max-[18rem]/row:contents";
const NARROW_CHIPS =
  "@max-[18rem]/row:col-span-full @max-[18rem]/row:row-start-3 @max-[18rem]/row:mt-0.5 @max-[18rem]/row:flex-wrap @max-[18rem]/row:justify-self-end";
/** Where the row opens, a chip may shrink and cut its word (`StatusBadge`'s label). */
const CUT_CHIPS =
  "min-w-0 flex-nowrap [&_[data-slot=badge]]:min-w-0 [&_[data-slot=badge]]:shrink [&_[data-slot=status-badge-label]]:min-w-0 [&_[data-slot=status-badge-label]]:truncate";

export function ListRow({
  title,
  meta,
  note,
  titleBadge,
  lead,
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
  // The stretched opener: its ::after covers the row, so the whole row is one target. It spans
  // the title and meta lines as a subgrid, so the meta line runs on under the chips.
  const opener =
    "focus-visible:ring-ring col-span-full row-start-1 grid min-w-0 grid-cols-subgrid grid-rows-subgrid gap-y-0.5 text-left outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset";
  const span = meta ? "row-span-2" : "";
  const text = (
    <>
      <span className="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5">
        {lead}
        <span data-slot="list-row-title" className={cn("min-w-0 text-sm font-medium", cut)}>
          {title}
        </span>
        {titleBadge}
      </span>
      {meta ? (
        <span
          data-slot="list-row-meta"
          className={cn("text-muted-foreground col-span-full row-start-2 min-w-0 text-xs", cut)}
        >
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
      className={cn("@container/row relative flex min-h-16 flex-col px-4 py-3", className)}
    >
      <div className={cn(ROW_GRID, "flex-1")}>
        {href !== undefined ? (
          <DrillLink
            href={href}
            data-slot="list-row-opener"
            className={cn(opener, span)}
            aria-label={openLabel}
          >
            {text}
          </DrillLink>
        ) : onOpen !== undefined ? (
          <button
            type="button"
            onClick={onOpen}
            data-slot="list-row-opener"
            className={cn(opener, span, "pressable-row")}
            aria-label={openLabel}
          >
            {text}
          </button>
        ) : (
          text
        )}
        {chips || parts.menu || parts.chevron ? (
          <span
            data-slot="list-row-trailing"
            className={cn(
              "col-start-2 row-start-1 flex items-center justify-end gap-2",
              parts.truncate && "min-w-0",
              NARROW_TRAILING,
            )}
          >
            {chips ? (
              <span
                data-slot="list-row-chips"
                className={cn(
                  "flex items-center gap-1.5",
                  parts.truncate ? CUT_CHIPS : "flex-wrap justify-end",
                  NARROW_CHIPS,
                )}
              >
                {chips}
              </span>
            ) : null}
            {parts.menu || parts.chevron ? (
              <span
                data-slot="list-row-end"
                className="col-start-2 row-start-1 flex shrink-0 items-center justify-end gap-2"
              >
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
          </span>
        ) : null}
        {note ? (
          <span
            data-slot="list-row-note"
            className="col-span-full row-start-3 text-xs break-words @max-[18rem]/row:row-start-4"
          >
            {note}
          </span>
        ) : null}
      </div>
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
      <div className={cn(ROW_GRID, "flex-1")}>
        <span className="col-start-1 row-start-1 flex h-5 min-w-0 items-center gap-1.5">
          {lead ? <Skeleton className="size-5 shrink-0 rounded-full" /> : null}
          <Skeleton className="h-4 w-44 max-w-full" />
        </span>
        {chips || chevron ? (
          <span
            className={cn(
              "col-start-2 row-start-1 flex min-w-0 items-center justify-end gap-2",
              NARROW_TRAILING,
            )}
          >
            {chips ? (
              <span className={cn("flex min-w-0 items-center", NARROW_CHIPS)}>
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
