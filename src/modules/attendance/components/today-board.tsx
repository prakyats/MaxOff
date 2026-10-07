import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/core/lib/utils";
import { DrillLink } from "@/core/ui/composites/drill-link";
import {
  CARD_ROW_MIN_H,
  CARD_ROW_PADDING,
  CARD_ROW_TITLE,
  CARD_ROW_TRAILING,
} from "@/core/ui/composites/row-metrics";
import { StatusDot } from "@/core/ui/composites/status-badge";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import {
  boardDetail,
  boardStatus,
  todayBucket,
  TODAY_BUCKET_LABELS,
  TODAY_BUCKETS,
  type BoardBucket,
  type TodayPerson,
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
 * "Today's attendance" on the Owner's /today (task 2.4; 6.2, PRODUCT §2 principle 11): the four
 * counts for the IST day. **Every count is tappable** (ROADMAP 6.2): "Waiting" opens Approvals
 * (another tab), the others open the full people board filtered to that group (a drill-down,
 * `/today/people?group=…`). On a day off it says so and counts only who came in.
 */
export function TodayAttendanceCard({ summary }: { summary: TodaySummary }) {
  return (
    <section
      aria-labelledby="today-attendance-title"
      data-slot="today-attendance-card"
      className="border-border bg-card mb-4 flex flex-col gap-3 rounded-lg border p-4"
    >
      <h2 id="today-attendance-title" className="text-sm font-medium">
        Today&apos;s attendance{summary.isDayOff ? " · Day off" : ""}
      </h2>
      <span className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {TODAY_BUCKETS.map((bucket) => {
          const content = (
            <>
              <span className="text-2xl font-semibold tabular-nums">{summary.counts[bucket]}</span>
              <span className="text-muted-foreground text-xs">{TODAY_BUCKET_LABELS[bucket]}</span>
            </>
          );
          const className =
            "focus-visible:ring-ring -m-1 flex flex-col rounded-md p-1 outline-none focus-visible:ring-2";
          return bucket === "waiting" ? (
            <Link
              key={bucket}
              href="/approvals"
              data-slot="today-count"
              data-bucket={bucket}
              className={cn("pressable-row", className)}
            >
              {content}
            </Link>
          ) : (
            <DrillLink
              key={bucket}
              href={`/today/people?group=${bucket}`}
              data-slot="today-count"
              data-bucket={bucket}
              className={className}
            >
              {content}
            </DrillLink>
          );
        })}
      </span>
    </section>
  );
}

/**
 * The people board under the card: everyone expected today, each exactly once, in the order the
 * Owner acts on them (waiting, not chosen yet, present, on leave, then absent), by name within
 * each. A row opens that person's
 * leave requests (`/people/[id]/leave`, with Attendance a tab away, 3.4), a real drill-down
 * (ARCHITECTURE §14.2 b).
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
                <DrillLink
                  href={`/people/${person.memberId}/leave`}
                  data-slot="board-row"
                  className={cn(
                    "focus-visible:ring-ring active:bg-muted/60 flex flex-wrap items-center gap-3 outline-none focus-visible:ring-2",
                    CARD_ROW_MIN_H,
                    CARD_ROW_PADDING,
                  )}
                >
                  <span className={cn("flex flex-col gap-0.5", CARD_ROW_TITLE)}>
                    <span className="truncate font-medium">{person.name}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {boardDetail(person)}
                    </span>
                  </span>
                  <StatusDot
                    status={BUCKET_DOT[bucket]}
                    label={boardStatus(person, bucket)}
                    className={CARD_ROW_TRAILING}
                  />
                  <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                </DrillLink>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * The card and the board while `/today` loads: the same boxes, rows and counts. Each bar sits in
 * the line box of the text it stands for (the card's title and a bucket heading `text-sm`, 20px;
 * a count `text-2xl`, 32px, over its `text-xs` label, 16px), so nothing moves when they arrive.
 */
export function TodayBoardSkeleton() {
  return (
    <div aria-hidden data-slot="loading-today-board">
      <div className="border-border bg-card mb-4 flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex h-5 items-center">
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {TODAY_BUCKETS.map((bucket) => (
            <div key={bucket} className="flex flex-col">
              <div className="flex h-8 items-center">
                <Skeleton className="h-7 w-8" />
              </div>
              <div className="flex h-4 items-center">
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mb-2 flex h-5 items-center">
        <Skeleton className="h-3.5 w-36" />
      </div>
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

/** Why a person is under the Owner's "Needs you" (6.2), in their row's status word. */
const REASON_LABELS = {
  waiting: "Waiting for a decision",
  not_chosen: "Not started",
  absent: "Absent",
  end_not_recorded: "End not recorded",
  overtime: "Overtime flagged",
} as const;

/**
 * "Needs you" on the Owner's Today (6.2): only the people who need attention today, each a row
 * like the board's (the day's start and end, a dot and the reason), opening their history.
 */
export function PeopleNeedingYou({
  rows,
  empty,
}: {
  rows: readonly {
    person: TodayPerson;
    bucket: BoardBucket;
    reason: keyof typeof REASON_LABELS;
  }[];
  empty: ReactNode;
}) {
  if (rows.length === 0) return <>{empty}</>;
  return (
    <ul
      aria-label="People who need you today"
      data-slot="people-needing-you"
      className="border-border divide-border bg-card divide-y rounded-lg border"
    >
      {rows.map(({ person, bucket, reason }) => (
        <li key={person.memberId}>
          <DrillLink
            href={`/people/${person.memberId}/leave`}
            data-slot="needs-you-person"
            data-reason={reason}
            className={cn(
              "focus-visible:ring-ring active:bg-muted/60 flex flex-wrap items-center gap-3 outline-none focus-visible:ring-2",
              CARD_ROW_MIN_H,
              CARD_ROW_PADDING,
            )}
          >
            <span className={cn("flex flex-col gap-0.5", CARD_ROW_TITLE)}>
              <span className="truncate font-medium">{person.name}</span>
              <span className="text-muted-foreground truncate text-xs">{boardDetail(person)}</span>
            </span>
            <StatusDot
              status={BUCKET_DOT[bucket]}
              label={REASON_LABELS[reason]}
              className={CARD_ROW_TRAILING}
            />
            <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
          </DrillLink>
        </li>
      ))}
    </ul>
  );
}

/** The card's tracing alone (Today's first block), the same boxes as `TodayBoardSkeleton`'s first. */
export function TodayCardSkeleton() {
  return (
    <div
      aria-hidden
      data-slot="loading-today-card"
      className="border-border bg-card mb-4 flex flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex h-5 items-center">
        <Skeleton className="h-4 w-36" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {TODAY_BUCKETS.map((bucket) => (
          <div key={bucket} className="flex flex-col">
            <div className="flex h-8 items-center">
              <Skeleton className="h-7 w-8" />
            </div>
            <div className="flex h-4 items-center">
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** `rows` person rows, as `PeopleNeedingYou` and the board draw them. */
export function PersonRowsSkeleton({ rows }: { rows: number }) {
  return (
    <ul aria-hidden className="border-border divide-border bg-card divide-y rounded-lg border">
      {Array.from({ length: rows }, (_, i) => (
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
  );
}

/**
 * A person's today in one line above their tabs on `/people/[id]` (6.2, ROADMAP; Kickoff 6
 * decision 7: the Owner's only, `attendance.view_all`): the state as a dot and a word, the start
 * and end times, overtime. Nothing when they are not expected today.
 */
export function PersonTodayLine({ person }: { person: TodayPerson | null }) {
  const bucket = person ? todayBucket(person) : null;
  if (!person || bucket === null) {
    return (
      <p
        data-slot="person-today"
        className="text-muted-foreground mb-4 flex min-h-6 items-center text-sm"
      >
        Not expected today
      </p>
    );
  }
  const detail = boardDetail(person);
  return (
    <p
      data-slot="person-today"
      data-bucket={bucket}
      className="mb-4 flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 text-sm"
    >
      <span className="text-muted-foreground">Today</span>
      <StatusDot status={BUCKET_DOT[bucket]} label={boardStatus(person, bucket)} />
      {detail && detail !== person.jobTitle ? (
        <span className="text-muted-foreground">· {detail}</span>
      ) : null}
    </p>
  );
}

export function PersonTodayLineSkeleton() {
  return (
    <div
      aria-hidden
      data-slot="loading-person-today"
      className="mb-4 flex min-h-6 items-center gap-2"
    >
      <Skeleton className="h-3.5 w-12" />
      <Skeleton className="h-3.5 w-40" />
    </div>
  );
}
