import { ChevronRightIcon, ClockIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { EmptyState } from "@/core/ui/composites/empty-state";
import {
  CARD_ROW_MIN_H,
  CARD_ROW_PADDING,
  CARD_ROW_TITLE,
  CARD_ROW_TRAILING,
} from "@/core/ui/composites/row-metrics";
import { StatusDot } from "@/core/ui/composites/status-badge";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { dayFigure, type MonthSummary, pendingText, summaryLines } from "../domain/summary";

/**
 * One person's month for the Owner (PRODUCT §4.18, 3b.4; `/people/[id]/month`): what is waiting
 * for review first (it changes the figures once decided), then PRODUCT's lines in its order,
 * additional leave marked as the one that can reduce pay. Live: it reads the days as they stand.
 */
export function MonthSummaryCard({ summary }: { summary: MonthSummary }) {
  const pending = pendingText(summary.pendingDays);
  return (
    <section
      aria-label="The month in figures"
      data-slot="month-summary"
      className="border-border bg-card rounded-lg border"
    >
      {pending ? (
        <div
          data-slot="month-pending"
          className="border-border flex min-h-11 items-center border-b px-4 py-2 text-sm"
        >
          <StatusDot status="pending_review" label={pending} />
        </div>
      ) : null}
      <dl className="divide-border divide-y">
        {summaryLines(summary).map((line) => (
          <div
            key={line.key}
            data-slot="month-line"
            data-line={line.key}
            className={cn(
              "flex min-h-12 flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2",
              line.emphasis && "bg-muted/60",
            )}
          >
            <dt className={cn("flex flex-col", CARD_ROW_TITLE)}>
              <span className={cn("text-sm", line.emphasis && "font-medium")}>{line.label}</span>
              {line.detail ? (
                <span className="text-muted-foreground text-xs">{line.detail}</span>
              ) : null}
            </dt>
            <dd
              className={cn(
                "text-base tabular-nums",
                CARD_ROW_TRAILING,
                line.emphasis ? "font-semibold" : "font-medium",
              )}
            >
              {line.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Which of the eight lines carry a detail line under the label (`summaryLines`). */
const LINES_WITH_DETAIL = [false, true, false, false, true, false, true, true];

/**
 * The card's tracing for `loading.tsx`: the eight lines, label left and figure right, with the
 * detail line under the four that have one. The "waiting for your review" row is data (most
 * months have none), so it is not reserved.
 */
export function MonthSummarySkeleton() {
  return (
    <div
      aria-hidden
      data-slot="loading-month-summary"
      className="border-border bg-card divide-border divide-y rounded-lg border"
    >
      {LINES_WITH_DETAIL.map((detail, i) => (
        <div key={i} className="flex min-h-12 items-center gap-3 px-4 py-2">
          <span className="flex flex-1 flex-col gap-1">
            <Skeleton className="h-4 w-2/5" />
            {detail ? <Skeleton className="h-3 w-3/5" /> : null}
          </span>
          <Skeleton className="h-4 w-10" />
        </div>
      ))}
    </div>
  );
}

/**
 * The team's month for the Owner (More → Reports → Month, kickoff 3b decision 30): one row per
 * person, days worked and additional leave at a glance, waiting days flagged, and `extra` (the
 * approved-unpaid expenses, handed in by the page from `modules/expenses`). A row opens that
 * person's month.
 */
export function TeamMonthList({
  summaries,
  month,
  extra,
}: {
  summaries: MonthSummary[];
  month: string;
  extra?: Readonly<Record<string, ReactNode>>;
}) {
  if (summaries.length === 0) {
    return (
      <EmptyState
        icon={ClockIcon}
        title="Nobody to show for this month"
        description="Admins and Staff who had joined by then appear here."
      />
    );
  }
  return (
    <ul
      data-slot="team-month"
      className="border-border divide-border bg-card divide-y rounded-lg border"
    >
      {summaries.map((summary) => (
        <li key={summary.memberId} data-slot="team-month-row">
          <DrillLink
            href={`/people/${summary.memberId}/month?month=${month}`}
            className={cn(
              "active:bg-muted/60 focus-visible:ring-ring flex flex-wrap items-center gap-x-3 gap-y-1 outline-none focus-visible:ring-2 focus-visible:ring-inset",
              CARD_ROW_MIN_H,
              CARD_ROW_PADDING,
            )}
          >
            <span className={cn("flex flex-col gap-0.5", CARD_ROW_TITLE)}>
              <span className="truncate font-medium">{summary.fullName}</span>
              <span className="text-muted-foreground text-sm tabular-nums">
                Worked {dayFigure(summary.daysWorked)} of {summary.workingDays} · additional leave{" "}
                {dayFigure(summary.additionalLeave)}
              </span>
              {summary.pendingDays > 0 ? (
                <StatusDot
                  status="pending_review"
                  label={pendingText(summary.pendingDays) ?? ""}
                  className="text-sm"
                />
              ) : null}
            </span>
            {/* The trailing part may wrap (phase 4 review A-S3): at 130% / 200% text a long
                unpaid line ("₹1,200.50 to pay · 1 claim") takes a line of its own and wraps
                inside it instead of reaching past the phone's edge. */}
            <span
              className={cn(
                "flex max-w-full min-w-0 items-center gap-2 text-sm",
                CARD_ROW_TRAILING,
                "shrink",
              )}
            >
              <span className="min-w-0 text-right">{extra?.[summary.memberId] ?? null}</span>
              <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
            </span>
          </DrillLink>
        </li>
      ))}
    </ul>
  );
}
