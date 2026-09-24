import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { cn } from "@/core/lib/utils";
import { CARD_ROW_MIN_H, CARD_ROW_PADDING } from "@/core/ui/composites/row-metrics";
import { StatusDot } from "@/core/ui/composites/status-badge";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import {
  boardDetail,
  boardStatus,
  TODAY_BUCKET_LABELS,
  TODAY_BUCKETS,
  type BoardBucket,
  type TodaySummary,
} from "../domain/review";

/** The dot follows the bucket, so the board reads at a glance and matches the card. */
const BUCKET_DOT: Record<BoardBucket, string> = {
  waiting: "pending_review",
  not_chosen: "awaiting_choice",
  present: "present",
  on_leave: "leave",
  absent: "absent",
};

/**
 * "Today's attendance" on the Owner's /today (task 2.4, the first piece of 6.2 that stays): the
 * four counts for the IST day, and one tap to Approvals. On a day off it says so and counts only
 * who came in.
 */
export function TodayAttendanceCard({ summary }: { summary: TodaySummary }) {
  return (
    <Link
      href="/approvals"
      data-slot="today-attendance-card"
      className="border-border bg-card focus-visible:ring-ring active:bg-muted/60 mb-4 flex flex-col gap-3 rounded-lg border p-4 outline-none focus-visible:ring-2"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          Today&apos;s attendance{summary.isDayOff ? " · Day off" : ""}
        </span>
        <ChevronRightIcon className="text-muted-foreground size-4" aria-hidden />
      </span>
      <span className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {TODAY_BUCKETS.map((bucket) => (
          <span key={bucket} data-slot="today-count" data-bucket={bucket} className="flex flex-col">
            <span className="text-2xl font-semibold tabular-nums">{summary.counts[bucket]}</span>
            <span className="text-muted-foreground text-xs">{TODAY_BUCKET_LABELS[bucket]}</span>
          </span>
        ))}
      </span>
    </Link>
  );
}

/**
 * The people board under the card: everyone expected today, each exactly once, in the order the
 * Owner acts on them (waiting, not chosen yet, present, on leave, then absent), by name within
 * each. A row opens that person's
 * attendance and leave (`/people/[id]`), a real drill-down (ARCHITECTURE §14.2 b).
 */
export function PeopleBoard({ summary }: { summary: TodaySummary }) {
  if (summary.board.length === 0) {
    return (
      <p data-slot="people-board-empty" className="text-muted-foreground mb-4 text-sm">
        {summary.isDayOff ? "Nobody has come in on this day off." : "Nobody to show yet."}
      </p>
    );
  }
  return (
    <div data-slot="people-board" className="mb-4 flex flex-col gap-4">
      {summary.board.map(({ bucket, people }) => (
        <section key={bucket} aria-labelledby={`board-${bucket}`}>
          <h2 id={`board-${bucket}`} className="text-muted-foreground mb-2 text-sm font-medium">
            {TODAY_BUCKET_LABELS[bucket]} <span className="tabular-nums">{people.length}</span>
          </h2>
          <ul className="border-border divide-border bg-card divide-y rounded-lg border">
            {people.map((person) => (
              <li key={person.memberId}>
                <Link
                  href={`/people/${person.memberId}`}
                  data-slot="board-row"
                  className={cn(
                    "focus-visible:ring-ring active:bg-muted/60 flex items-center gap-3 outline-none focus-visible:ring-2",
                    CARD_ROW_MIN_H,
                    CARD_ROW_PADDING,
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-medium">{person.name}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {boardDetail(person)}
                    </span>
                  </span>
                  <StatusDot
                    status={BUCKET_DOT[bucket]}
                    label={boardStatus(person, bucket)}
                    className="shrink-0"
                  />
                  <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The card and the board while `/today` loads: the same boxes, rows and counts. */
export function TodayBoardSkeleton() {
  return (
    <div aria-hidden data-slot="loading-today-board">
      <div className="border-border bg-card mb-4 flex flex-col gap-3 rounded-lg border p-4">
        <Skeleton className="h-4 w-36" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {TODAY_BUCKETS.map((bucket) => (
            <div key={bucket} className="flex flex-col gap-1.5">
              <Skeleton className="h-7 w-8" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
      <Skeleton className="mb-2 h-3.5 w-36" />
      <ul className="border-border divide-border bg-card mb-4 divide-y rounded-lg border">
        {[0, 1, 2].map((i) => (
          <li key={i} className={cn("flex items-center gap-3", CARD_ROW_MIN_H, CARD_ROW_PADDING)}>
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </span>
            <Skeleton className="h-3 w-16" />
            <Skeleton className="size-4 rounded-sm" />
          </li>
        ))}
      </ul>
    </div>
  );
}
