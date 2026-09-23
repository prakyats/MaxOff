import { cn } from "@/core/lib/utils";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { PageHeader } from "./page-header";

import { CARD_ROW_MIN_H, CARD_ROW_PADDING, LIST_ROW_MIN_H } from "./row-metrics";

/**
 * The shapes a loading state can take (ARCHITECTURE §14.1).
 *
 * A skeleton is a **tracing of the content it replaces** — same row height, same number of
 * text lines, same column positions, same place for the status chip — so nothing moves when
 * the data arrives. A generic avatar list standing in for a task list makes the app feel
 * slower than it is, because the layout visibly swaps.
 *
 * - `list`   — a row of text with an optional leading dot and trailing actions (settings rows,
 *              the approvals inbox, notifications).
 * - `cards`  — the mobile card list `DataTable` renders below `md`: title, subtitle, chevron.
 * - `tiles`  — a responsive grid of stat tiles (Today, Reports).
 * - `detail` — one record: a heading block and labelled field rows (My profile, a form).
 * - `table`  — the desktop table: a header row and aligned columns.
 */
export type LoadingShape = "list" | "cards" | "tiles" | "detail" | "table";

interface LoadingStateProps {
  /** What the real screen looks like. Required so no screen gets a stand-in from another one. */
  shape: LoadingShape;
  /** How many placeholder items. Three to five is enough — never a full screen of them. */
  count?: number | undefined;
  /** Trailing action placeholders per row (`list` only), e.g. 2 for approve / reject. */
  actions?: number | undefined;
  /** Column widths for `table`, as Tailwind width classes; also sets the column count. */
  columns?: readonly string[] | undefined;
  className?: string | undefined;
  label?: string | undefined;
}

const DEFAULT_COUNT: Record<LoadingShape, number> = {
  list: 5,
  cards: 4,
  tiles: 4,
  detail: 5,
  table: 5,
};

/**
 * Skeleton placeholder shaped like the screen it replaces. Pass the `shape` that matches the
 * real content; a route's `loading.tsx` passes the shape its own page renders, and a
 * placeholder route passes the shape its real screen will have, so the switch to real data in
 * phases 2–8 moves nothing.
 */
export function LoadingState({
  shape,
  count,
  actions = 0,
  columns = ["w-1/3", "w-1/4", "w-1/6", "w-1/6"],
  className,
  label = "Loading",
}: LoadingStateProps) {
  const items = count ?? DEFAULT_COUNT[shape];

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      data-slot="loading-state"
      data-shape={shape}
      className={cn(shape === "tiles" ? "grid grid-cols-2 gap-3 lg:grid-cols-4" : null, className)}
    >
      {shape === "list" ? <ListSkeleton items={items} actions={actions} /> : null}
      {shape === "cards" ? <CardsSkeleton items={items} /> : null}
      {shape === "tiles" ? <TilesSkeleton items={items} /> : null}
      {shape === "detail" ? <DetailSkeleton items={items} /> : null}
      {shape === "table" ? <TableSkeleton items={items} columns={columns} /> : null}
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** Rows of text with a leading status dot, and optional trailing action buttons. */
function ListSkeleton({ items, actions }: { items: number; actions: number }) {
  return (
    <ul className="border-border divide-border bg-card divide-y rounded-lg border">
      {Array.from({ length: items }, (_, i) => (
        <li
          key={i}
          data-slot="loading-row"
          className={cn("flex items-center gap-3 px-4", LIST_ROW_MIN_H)}
        >
          <Skeleton className="size-2 shrink-0 rounded-full" />
          <Skeleton className="h-3.5 max-w-48 flex-1" />
          {Array.from({ length: actions }, (_, a) => (
            <Skeleton key={a} className="h-8 w-16 shrink-0 rounded-md" />
          ))}
        </li>
      ))}
    </ul>
  );
}

/**
 * The mobile card list. Height and padding come from `row-metrics`, the same constants
 * `DataTable` uses for a real card, so the two cannot drift apart.
 */
function CardsSkeleton({ items }: { items: number }) {
  return (
    <ul className="border-border divide-border bg-card divide-y rounded-lg border">
      {Array.from({ length: items }, (_, i) => (
        <li
          key={i}
          data-slot="loading-row"
          className={cn("flex items-center gap-3", CARD_ROW_MIN_H, CARD_ROW_PADDING)}
        >
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </span>
          <Skeleton className="size-4 shrink-0 rounded-sm" />
        </li>
      ))}
    </ul>
  );
}

/** Stat tiles: a short label over a big number. */
function TilesSkeleton({ items }: { items: number }) {
  return (
    <>
      {Array.from({ length: items }, (_, i) => (
        <div
          key={i}
          data-slot="loading-tile"
          className="border-border bg-card flex flex-col gap-2 rounded-lg border p-4"
        >
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-12" />
        </div>
      ))}
    </>
  );
}

/** One record: a heading block, then labelled field rows. */
function DetailSkeleton({ items }: { items: number }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Skeleton className="size-12 shrink-0 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4">
        {Array.from({ length: items }, (_, i) => (
          <div key={i} data-slot="loading-field" className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The desktop table: a header row, then aligned columns. */
function TableSkeleton({ items, columns }: { items: number; columns: readonly string[] }) {
  return (
    <div className="border-border bg-card overflow-hidden rounded-lg border">
      <div className="border-border flex items-center gap-4 border-b px-4 py-3">
        {columns.map((width, c) => (
          <Skeleton key={c} className={cn("h-3", width)} />
        ))}
      </div>
      <div className="divide-border divide-y">
        {Array.from({ length: items }, (_, i) => (
          <div key={i} data-slot="loading-row" className="flex items-center gap-4 px-4 py-3">
            {columns.map((width, c) => (
              <Skeleton key={c} className={cn("h-4", width)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * What a route's `loading.tsx` renders: **the title bar straight away**, then a skeleton shaped
 * like that route's content.
 *
 * The header needs no data, so showing it during the load means you can always tell which
 * screen you are on — the alternative is a moment of anonymous grey blocks. Everything below it
 * is a tracing of the real content, so nothing jumps when the data arrives.
 */
export function PageLoading({
  title,
  shape,
  count,
  actions,
  back,
  children,
}: {
  title: string;
  shape: LoadingShape;
  count?: number | undefined;
  actions?: number | undefined;
  back?: { href: string; label: string } | undefined;
  /** Replaces the default skeleton when a screen needs a shape of its own (e.g. the calendar). */
  children?: React.ReactNode;
}) {
  return (
    <>
      <PageHeader title={title} {...(back ? { back } : {})} />
      {children ?? (
        <LoadingState shape={shape} count={count} actions={actions} label={`Loading ${title}`} />
      )}
    </>
  );
}
