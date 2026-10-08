import { ChevronRightIcon } from "lucide-react";
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
  countShown,
  todayBucket,
  TODAY_BUCKET_LABELS,
  TODAY_BUCKETS,
  TODAY_CARD_COUNTS,
  TODAY_CARD_LABELS,
  TODAY_CARD_TONES,
  type BoardBucket,
  type CountTone,
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

/** A count's colour (decision 24): the number and its dot together, never the number alone. */
const COUNT_NUMBER: Record<CountTone | "zero", string> = {
  attention: "text-attention",
  danger: "text-danger",
  neutral: "text-foreground",
  zero: "text-muted-foreground",
};
const COUNT_DOT: Record<CountTone | "zero", string> = {
  attention: "bg-attention",
  danger: "bg-danger",
  neutral: "bg-neutral",
  zero: "bg-muted-foreground/40",
};

/**
 * "Today's attendance" on the Owner's /today (task 2.4; 6.2, PRODUCT §2 principle 11; kickoff 6
 * decision 24, owner 2026-10-07): the counts for the IST day, the four groups always and Absent
 * and "End of day not recorded" only above zero, each coloured by urgency with its dot and label.
 * **Every count is tappable** (ROADMAP 6.2): "Waiting" opens Approvals (another tab), the others
 * open the full people board filtered to that group (a drill-down, `/today/people?group=…`); the
 * card's title opens the whole board. On a day off it says so and counts only who came in.
 */
export function TodayAttendanceCard({ summary }: { summary: TodaySummary }) {
  return (
    <section
      aria-labelledby="today-attendance-title"
      data-slot="today-attendance-card"
      className="border-border bg-card mb-4 flex flex-col gap-3 rounded-lg border p-4"
    >
      <h2
        id="today-attendance-title"
        data-slot="today-see-all-people"
        className="flex h-5 items-center text-sm font-medium"
      >
        <DrillLink
          href="/today/people"
          aria-label="Today's attendance: everyone today"
          className="focus-visible:ring-ring -my-3 -ml-1 inline-flex min-h-11 items-center gap-1 rounded-md px-1 outline-none focus-visible:ring-2"
        >
          Today&apos;s attendance{summary.isDayOff ? " · Day off" : ""}
          <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
        </DrillLink>
      </h2>
      <span className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {TODAY_CARD_COUNTS.filter((count) => countShown(count, summary.counts[count])).map(
          (count) => {
            const value = summary.counts[count];
            const tone = value > 0 ? TODAY_CARD_TONES[count] : "zero";
            const content = (
              <>
                <span
                  className={cn("text-2xl font-semibold tabular-nums", COUNT_NUMBER[tone])}
                  data-tone={tone}
                >
                  {value}
                </span>
                <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <span
                    aria-hidden
                    className={cn("size-2 shrink-0 rounded-full", COUNT_DOT[tone])}
                  />
                  {TODAY_CARD_LABELS[count]}
                </span>
              </>
            );
            const className =
              "focus-visible:ring-ring -m-1 flex flex-col rounded-md p-1 outline-none focus-visible:ring-2";
            return count === "waiting" ? (
              <Link
                key={count}
                href="/approvals"
                data-slot="today-count"
                data-bucket={count}
                className={cn("pressable-row", className)}
              >
                {content}
              </Link>
            ) : (
              <DrillLink
                key={count}
                href={`/today/people?group=${count}`}
                data-slot="today-count"
                data-bucket={count}
                className={className}
              >
                {content}
              </DrillLink>
            );
          },
        )}
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
export function PeopleBoard({
  summary,
  empty,
}: {
  summary: TodaySummary;
  empty?: string | undefined;
}) {
  if (summary.board.length === 0) {
    return (
      <p data-slot="people-board-empty" className="text-muted-foreground mb-4 text-sm">
        {empty ??
          (summary.isDayOff ? "Nobody has come in on this day off." : "Nobody to show yet.")}
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

/** `rows` person rows, as the board draws them. */
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
