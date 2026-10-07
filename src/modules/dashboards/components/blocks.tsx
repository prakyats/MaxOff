import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "@/core/ui/composites/row-metrics";
import { type StatusTone, StatusDot } from "@/core/ui/composites/status-badge";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * The dashboards' building blocks (6A: My Day, the Owner's and the Admin's Today). **Server
 * components only**: these screens hold a first-load budget (6.0), so nothing here hydrates; a
 * row is a link (`DrillLink` for a drill-down, a plain `Link` for another tab) and "See all" is a
 * native `<details>` (a view control with no history and no script). Each block has a skeleton of
 * the same rows, heights and columns (ARCHITECTURE §14.1).
 */

/** A section: its heading ("Needs you · 3") and its rows. */
export function DashSection({
  title,
  slot,
  count,
  children,
  action,
}: {
  title: string;
  slot: string;
  count?: number;
  children: ReactNode;
  /** A neutral control beside the heading ("Suggest a task"). */
  action?: ReactNode;
}) {
  const id = `${slot}-title`;
  return (
    <section aria-labelledby={id} data-slot={slot} className="flex min-w-0 flex-col gap-2">
      <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 id={id} className="text-sm font-semibold">
          {title}
          {count !== undefined && count > 0 ? (
            <span className="text-muted-foreground font-normal"> · {count}</span>
          ) : null}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A section heading's skeleton: the `h2`'s 20px line box. */
export function DashSectionHeadingSkeleton({ width = "w-28" }: { width?: string }) {
  return (
    <div className="flex h-5 min-w-0 items-center">
      <Skeleton className={cn("h-4 max-w-full", width)} />
    </div>
  );
}

/** One bordered block of rows, divided (§14.1 cards). */
export function RowList({
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
      data-slot={slot}
      className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border"
    >
      {children}
    </ul>
  );
}

const ROW =
  "focus-visible:ring-ring flex min-h-12 items-center gap-3 px-4 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset";

/**
 * A row that opens what it says (PRODUCT §2: every count or summary is tappable). `tab`: another
 * tab's screen (Tasks, Approvals, Calendar), a plain link; otherwise a drill-down.
 */
export function LinkRow({
  href,
  slot,
  icon,
  title,
  detail,
  trailing,
  tab = false,
}: {
  href: string;
  slot: string;
  icon?: ReactNode;
  title: ReactNode;
  /** A second, quieter line. */
  detail?: ReactNode;
  /** A marker before the chevron (a status dot). */
  trailing?: ReactNode;
  tab?: boolean;
}) {
  const content = (
    <>
      {icon ? <span className="text-muted-foreground shrink-0">{icon}</span> : null}
      <span className={cn("flex flex-col gap-0.5", CARD_ROW_TITLE)}>
        <span className="font-medium break-words">{title}</span>
        {detail ? (
          <span className="text-muted-foreground text-xs break-words">{detail}</span>
        ) : null}
      </span>
      {trailing ? <span className={CARD_ROW_TRAILING}>{trailing}</span> : null}
      <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
    </>
  );
  return (
    <li data-slot={slot}>
      {tab ? (
        <Link href={href} className={cn("pressable-row flex-wrap", ROW)}>
          {content}
        </Link>
      ) : (
        <DrillLink href={href} className={cn("flex-wrap", ROW)}>
          {content}
        </DrillLink>
      )}
    </li>
  );
}

/** `rows` skeleton rows of a `RowList` of `LinkRow`s (`detail`: with the second line). */
export function LinkRowsSkeleton({
  rows,
  detail = false,
  trailing = false,
  slot,
}: {
  rows: number;
  detail?: boolean;
  trailing?: boolean;
  slot?: string;
}) {
  return (
    <ul
      aria-hidden
      data-slot={slot}
      className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border"
    >
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className={cn(ROW, "min-w-0")}>
          <span className={cn("flex flex-col gap-0.5", CARD_ROW_TITLE)}>
            <span className="flex h-5 min-w-0 items-center">
              <Skeleton className="h-4 w-48 max-w-full" />
            </span>
            {detail ? (
              <span className="flex h-4 min-w-0 items-center">
                <Skeleton className="h-3 w-36 max-w-full" />
              </span>
            ) : null}
          </span>
          {trailing ? <Skeleton className={cn("h-3 w-16", CARD_ROW_TRAILING)} /> : null}
          <Skeleton className="size-4 shrink-0 rounded-sm" />
        </li>
      ))}
    </ul>
  );
}

/** A quiet line of text under a section heading (an empty state, a holiday). */
export function QuietText({ slot, children }: { slot: string; children: ReactNode }) {
  return (
    <p data-slot={slot} className="text-muted-foreground text-sm">
      {children}
    </p>
  );
}

export function QuietTextSkeleton({ width = "w-48" }: { width?: string }) {
  return (
    <div aria-hidden className="flex h-5 min-w-0 items-center">
      <Skeleton className={cn("h-3.5 max-w-full", width)} />
    </div>
  );
}

/** A row's status marker: a dot and a word, never colour alone (§14.1). */
export function Marker({ label, tone }: { label: string; tone: StatusTone }) {
  return <StatusDot status={label} tone={tone} label={label} />;
}

/**
 * The first `shown` rows, then the rest behind a native "See all N" (decision 6: "5, then See
 * all"): a view control that opens in place, adds no history and needs no script.
 */
export function ShowFirst({
  rows,
  shown,
  label,
  slot,
}: {
  rows: readonly ReactNode[];
  shown: number;
  label: string;
  slot: string;
}) {
  const first = rows.slice(0, shown);
  const rest = rows.slice(shown);
  return (
    <div data-slot={slot} className="flex min-w-0 flex-col gap-2">
      <RowList label={label}>{first}</RowList>
      {rest.length > 0 ? (
        <details className="group flex min-w-0 flex-col gap-2" data-slot={`${slot}-more`}>
          <summary className="border-border bg-card text-foreground focus-visible:ring-ring pressable-row flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm font-medium outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">See all {rows.length}</span>
            <span className="hidden group-open:inline">Show fewer</span>
            <ChevronRightIcon
              className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-90"
              aria-hidden
            />
          </summary>
          <div className="mt-2">
            <RowList label={`${label}, the rest`}>{rest}</RowList>
          </div>
        </details>
      ) : null}
    </div>
  );
}
