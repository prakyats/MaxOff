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
  cardLineWords,
  todayBucket,
  TODAY_BUCKET_LABELS,
  TODAY_BUCKETS,
  TODAY_CARD_LABELS,
  TODAY_CARD_LINES,
  TODAY_CARD_TONES,
  TODAY_STRIP_COUNTS,
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
 * The strip: the four counts in one row (owner 2026-10-09). A container query, in rem, so it holds
 * four only while four fit their labels on one line: a 375px phone at the default text size has
 * room (21rem of 21.4rem); at large system text (§14.2 i) it is two rows of two, never a label
 * wrapped or cut.
 */
const COUNT_GRID =
  "border-border bg-card grid grid-cols-2 gap-1 rounded-lg border p-1 @min-[21rem]:grid-cols-4";
/** One count: the dot and the number on a 24px line, the label under it; 44px tall at least. */
const COUNT_CELL =
  "focus-visible:ring-ring flex min-h-11 min-w-0 flex-col justify-center rounded-md px-1 py-1 outline-none focus-visible:ring-2";

/**
 * "Today's attendance" on the Owner's /today (task 2.4; 6.2, PRODUCT §2 principle 11; kickoff 6
 * decision 24, owner 2026-10-07): the counts for the IST day, each coloured by urgency with its dot
 * and label. **Every count is tappable** (ROADMAP 6.2): "Waiting" opens Approvals (another tab),
 * the others open the full people board filtered to that group (a drill-down,
 * `/today/people?group=…`); the section's title opens the whole board. On a day off it says so and
 * counts only who came in.
 *
 * **The Today refresh (owner 2026-10-09, and his preview review the same day):** the section's
 * heading ("Attendance ›") above a strip of exactly four counts, Not started · Waiting · Present ·
 * On leave, in one row, each a 44px tap target with its label on one line. The problem counts are
 * never a fifth cell: each is one red line under the strip, "1 didn't end their day yesterday ›",
 * "2 are absent today ›", hidden at zero, opening the same filtered board as the count did.
 */
export function TodayAttendanceCard({ summary }: { summary: TodaySummary }) {
  const lines = TODAY_CARD_LINES.flatMap((line) => {
    const words = cardLineWords(line, summary.counts[line]);
    return words ? [{ line, words }] : [];
  });
  return (
    <section
      aria-labelledby="today-attendance-title"
      data-slot="today-attendance-card"
      className="@container flex min-w-0 flex-col gap-2"
    >
      <h2
        id="today-attendance-title"
        data-slot="today-see-all-people"
        className="flex min-h-5 items-center text-sm font-semibold"
      >
        <DrillLink
          href="/today/people"
          aria-label="Today's attendance: everyone today"
          className="focus-visible:ring-ring -my-3 -ml-1 inline-flex min-h-11 items-center gap-1 rounded-md px-1 outline-none focus-visible:ring-2"
        >
          Attendance{summary.isDayOff ? " · Day off" : ""}
          <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
        </DrillLink>
      </h2>
      <span className={COUNT_GRID} data-slot="today-strip">
        {TODAY_STRIP_COUNTS.map((count) => {
          const value = summary.counts[count];
          const tone = value > 0 ? TODAY_CARD_TONES[count] : "zero";
          const content = (
            <>
              <span className="flex h-6 items-center gap-1.5">
                <span aria-hidden className={cn("size-2 shrink-0 rounded-full", COUNT_DOT[tone])} />
                <span
                  className={cn("text-lg font-semibold tabular-nums", COUNT_NUMBER[tone])}
                  data-tone={tone}
                >
                  {value}
                </span>
              </span>
              <span
                data-slot="today-count-label"
                className="text-muted-foreground text-xs whitespace-nowrap"
              >
                {TODAY_CARD_LABELS[count]}
              </span>
            </>
          );
          return count === "waiting" ? (
            <Link
              key={count}
              href="/approvals"
              data-slot="today-count"
              data-bucket={count}
              className={cn("pressable-row", COUNT_CELL)}
            >
              {content}
            </Link>
          ) : (
            <DrillLink
              key={count}
              href={`/today/people?group=${count}`}
              data-slot="today-count"
              data-bucket={count}
              className={COUNT_CELL}
            >
              {content}
            </DrillLink>
          );
        })}
      </span>
      {lines.map(({ line, words }) => (
        <DrillLink
          key={line}
          href={`/today/people?group=${line}`}
          data-slot="today-attendance-line"
          data-bucket={line}
          data-tone="danger"
          className="focus-visible:ring-ring text-danger -my-1 flex min-h-11 min-w-0 items-center gap-2 rounded-md text-sm outline-none focus-visible:ring-2"
        >
          <span aria-hidden className="bg-danger size-2 shrink-0 rounded-full" />
          <span className="min-w-0 break-words">{words}</span>
          <ChevronRightIcon className="size-4 shrink-0" aria-hidden />
        </DrillLink>
      ))}
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
/**
 * The Owner's attendance section while Today loads: its heading and the strip of four, the same
 * container query and cells. The red lines under it are not drawn: each shows only above zero and
 * nothing the loading screen traces sits under them.
 */
export function TodayCardSkeleton() {
  return (
    <div
      aria-hidden
      data-slot="loading-today-card"
      className="@container flex min-w-0 flex-col gap-2"
    >
      <div className="flex h-5 items-center">
        <Skeleton className="h-4 w-24" />
      </div>
      <div className={COUNT_GRID}>
        {TODAY_STRIP_COUNTS.map((bucket) => (
          <div key={bucket} className={COUNT_CELL}>
            <div className="flex h-6 items-center gap-1.5">
              <Skeleton className="size-2 rounded-full" />
              <Skeleton className="h-5 w-5" />
            </div>
            <div className="flex h-4 items-center">
              <Skeleton className="h-3 w-12 max-w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
