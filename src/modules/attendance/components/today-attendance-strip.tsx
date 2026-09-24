import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { attendanceHref } from "@/core/auth/day-gate";
import { touchToday } from "@/core/auth/gate";
import { StatusDot } from "@/core/ui/composites/status-badge";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { todayIST } from "@/core/time";

import { getOwnDay } from "../data/attendance";
import { describeTodayStrip } from "../domain/today";

import { WorkingTodayButton } from "./working-today-button";

/** Where a tap on the strip goes: the day's history, or the gate when there is no choice yet. */
const HISTORY_HREF = "/leave/attendance";

/**
 * Today's attendance as **one line** at the top of My Day (Staff) and /today (Admins):
 * "● Present · waiting for approval ›" (2.3 polish; PRODUCT §4.10: My Day is mainly tasks, so
 * attendance takes one row). A tap opens the day's history on /leave, or the choice screen when
 * the day still has no answer. On a day of approved leave the strip keeps the banner's optional
 * "I'm working today" (PRODUCT §4.2). Log out is a quiet row at the bottom of the page, and
 * overtime lives in the Log out confirmation and on today's entry in /leave.
 */
export async function TodayAttendanceStrip({
  memberId,
  home,
}: {
  memberId: string;
  /** Where the choice screen returns to. */
  home: string;
}) {
  const today = todayIST();
  // No row yet can mean the layout's touch is still opening today's day (layout and page
  // render in parallel): wait for that same call (`cache()`), then read again, past Next's
  // per-request memo of the first read. On the joining day there is still no row afterwards,
  // which is the right answer.
  let day = await getOwnDay(memberId, today);
  if (!day) {
    await touchToday();
    day = await getOwnDay(memberId, today, { fresh: true });
  }
  const strip = describeTodayStrip(day);
  const href = strip.kind === "choose" ? attendanceHref(home) : HISTORY_HREF;

  return (
    <div
      data-slot="attendance-strip"
      className="border-border bg-card mb-4 flex min-h-11 items-center gap-2 rounded-lg border pr-1"
    >
      <Link
        href={href}
        aria-label={`Today's attendance: ${strip.text}`}
        className="active:bg-muted/60 focus-visible:ring-ring flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg pl-3 outline-none select-none focus-visible:ring-2"
      >
        <StatusDot status={strip.dot} label="" className="shrink-0" />
        <span data-slot="attendance-status" className="truncate text-sm font-medium">
          {strip.text}
        </span>
        {strip.kind === "on_leave" ? null : (
          <ChevronRightIcon className="text-muted-foreground ml-auto size-4 shrink-0" aria-hidden />
        )}
      </Link>
      {strip.kind === "on_leave" ? (
        <div className="shrink-0">
          <WorkingTodayButton label={strip.workingLabel} forDate={today} size="sm" />
        </div>
      ) : null}
    </div>
  );
}

/** The strip's tracing for `loading.tsx` (ARCHITECTURE §14.1): one 44px row, dot and text. */
export function TodayAttendanceStripSkeleton() {
  return (
    <div
      data-slot="attendance-strip-skeleton"
      aria-hidden
      className="border-border bg-card mb-4 flex min-h-11 items-center gap-2 rounded-lg border px-3"
    >
      <Skeleton className="size-2 shrink-0 rounded-full" />
      <Skeleton className="h-4 w-48" />
      <Skeleton className="ml-auto size-4 shrink-0 rounded-sm" />
    </div>
  );
}
