import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import {
  ENGAGEMENT_LABELS,
  ENGAGEMENTS,
  type Engagement,
  type LoadRow,
  loadWords,
  type Split,
} from "../domain/work-report";

/**
 * The Admin's work report's blocks (6.3): a KPI card per number, the employees' and the
 * freelancers' values side by side with the last period beside each, and the load list. Server
 * components: the report is read, not edited.
 */

export type KpiCardProps = {
  slot: string;
  title: string;
  /** What the number is, one line (PRODUCT §4.13's definition, in plain words). */
  definition: string;
  /** Each engagement's value now, as words. */
  now: Split<string>;
  /** The same for the last period; null for a number that is "now" only (Overdue now). */
  before: Split<string> | null;
  /** Where a tap goes (Overdue now: the list), else none. */
  href?: string;
};

export function KpiCard({ slot, title, definition, now, before, href }: KpiCardProps) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        {href ? (
          <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
        ) : null}
      </span>
      <span className="text-muted-foreground text-xs">{definition}</span>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ENGAGEMENTS.map((engagement) => (
          <div key={engagement} className="flex min-w-0 flex-col" data-engagement={engagement}>
            <dt className="text-muted-foreground text-xs">{ENGAGEMENT_LABELS[engagement]}</dt>
            <dd className="text-base font-semibold tabular-nums" data-slot="kpi-now">
              {now[engagement]}
            </dd>
            {before ? (
              <dd className="text-muted-foreground text-xs" data-slot="kpi-before">
                Last period: {before[engagement]}
              </dd>
            ) : null}
          </div>
        ))}
      </dl>
    </>
  );
  const className =
    "border-border bg-card focus-visible:ring-ring flex min-w-0 flex-col gap-2 rounded-lg border p-4 outline-none focus-visible:ring-2";
  return href ? (
    <Link href={href} data-slot={slot} className={cn("pressable-row", className)}>
      {body}
    </Link>
  ) : (
    <section data-slot={slot} className={className} aria-label={title}>
      {body}
    </section>
  );
}

/**
 * One client-work number (7.4, kickoff 7 decision 25): items have no engagement, so one value with
 * the last period beside it (null: "now" only, as Cycle progress), or a short list (where items sit
 * longest). The KPI card's shell, so the two kinds line up in the grid; with `href` the whole card
 * is the tap target to its list (Overdue now's items), as the task card.
 */
export function ItemKpiCard({
  slot,
  title,
  definition,
  now,
  before,
  lines,
  empty,
  href,
}: {
  slot: string;
  title: string;
  definition: string;
  now?: string;
  before?: string | null;
  lines?: readonly string[];
  empty?: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        {href ? (
          <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
        ) : null}
      </span>
      <span className="text-muted-foreground text-xs">{definition}</span>
      {now !== undefined ? (
        <dl className="flex min-w-0 flex-col">
          <dt className="text-muted-foreground text-xs">Client items</dt>
          <dd className="text-base font-semibold break-words tabular-nums" data-slot="kpi-now">
            {now}
          </dd>
          {before ? (
            <dd className="text-muted-foreground text-xs" data-slot="kpi-before">
              Last period: {before}
            </dd>
          ) : null}
        </dl>
      ) : null}
      {lines ? (
        lines.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm" data-slot="kpi-lines">
            {lines.map((line) => (
              <li key={line} className="break-words">
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{empty}</p>
        )
      ) : null}
    </>
  );
  const className = "border-border bg-card flex min-w-0 flex-col gap-2 rounded-lg border p-4";
  return href ? (
    <Link
      href={href}
      data-slot={slot}
      className={cn(
        "pressable-row focus-visible:ring-ring outline-none focus-visible:ring-2",
        className,
      )}
    >
      {body}
    </Link>
  ) : (
    <section data-slot={slot} aria-label={title} className={className}>
      {body}
    </section>
  );
}

export function KpiCardSkeleton() {
  return (
    <div
      aria-hidden
      className="border-border bg-card flex min-w-0 flex-col gap-2 rounded-lg border p-4"
    >
      <div className="flex h-5 items-center">
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="flex h-4 items-center">
        <Skeleton className="h-3 w-48 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col">
            <div className="flex h-4 items-center">
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="flex h-6 items-center">
              <Skeleton className="h-5 w-24" />
            </div>
            <div className="flex h-4 items-center">
              <Skeleton className="h-3 w-28" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** "Who is loaded this week": each person's open and overdue tasks, by engagement (never a rating). */
export function LoadList({
  rows,
  nameOf,
  empty,
}: {
  rows: Split<LoadRow[]>;
  nameOf: (memberId: string) => string;
  empty: ReactNode;
}) {
  const any = ENGAGEMENTS.some((engagement) => rows[engagement].length > 0);
  if (!any) return <>{empty}</>;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-slot="load-list">
      {ENGAGEMENTS.map((engagement: Engagement) =>
        rows[engagement].length > 0 ? (
          <div key={engagement} className="flex min-w-0 flex-col gap-2">
            <h3 className="text-muted-foreground text-xs font-medium">
              {ENGAGEMENT_LABELS[engagement]}
            </h3>
            <ul className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border">
              {rows[engagement].map((row) => (
                <li
                  key={row.memberId}
                  data-slot="load-row"
                  className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 text-sm"
                >
                  <span className="min-w-0 font-medium break-words">{nameOf(row.memberId)}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {loadWords(row)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}
