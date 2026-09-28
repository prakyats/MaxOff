import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { StatusDot } from "@/core/ui/composites/status-badge";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { getOwnToday } from "../data/attendance";
import { getNoteDays } from "../data/notes";
import type { NoteDay } from "../domain/notes";
import { describeTodayStrip, type StripAction } from "../domain/today";

import { EndDayButton, StartDayButton } from "./day-actions";
import { AddNoteButton } from "./add-note-button";
import { WorkingTodayButton } from "./working-today-button";

/** Where a tap on the strip's text goes: the day's history. */
const HISTORY_HREF = "/leave/attendance";

/**
 * Today's attendance as **one line** at the top of My Day (Staff) and /today (Admins):
 * "● Not started · Start day", "● Started 9:12 am · waiting for approval · End day",
 * "● Day off · I worked today" (2.3 polish, reworked in 3b.1; PRODUCT §4.2). The text opens the
 * day's history on /leave; the one button beside it is the day's next action
 * (`describeTodayStrip`). Since 3b.1 nothing is opened by rendering this: the day exists only
 * once the person starts it or chooses leave (`attendance_own_today()` reads, never writes).
 */
export async function TodayAttendanceStrip() {
  const today = await getOwnToday();
  const strip = describeTodayStrip(today);
  // A day off offers the "I worked today" note (3b.2), whose dialog needs the last 8 days' kinds.
  const noteDays = strip.action?.kind === "worked_day_off" ? await getNoteDays(today.workDate) : [];

  return (
    <div
      data-slot="attendance-strip"
      data-kind={strip.kind}
      className="border-border bg-card mb-4 flex min-h-11 items-center gap-2 rounded-lg border pr-1"
    >
      <Link
        href={HISTORY_HREF}
        aria-label={`Today's attendance: ${strip.text}`}
        className="active:bg-muted/60 focus-visible:ring-ring flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg pl-3 outline-none select-none focus-visible:ring-2"
      >
        <StatusDot status={strip.dot} label="" className="shrink-0" />
        <span data-slot="attendance-status" className="truncate text-sm font-medium">
          {strip.text}
        </span>
        {strip.action ? null : (
          <ChevronRightIcon className="text-muted-foreground ml-auto size-4 shrink-0" aria-hidden />
        )}
      </Link>
      {strip.action ? (
        <div className="shrink-0">
          <StripActionButton action={strip.action} workDate={today.workDate} noteDays={noteDays} />
        </div>
      ) : null}
    </div>
  );
}

function StripActionButton({
  action,
  workDate,
  noteDays,
}: {
  action: StripAction;
  workDate: string;
  noteDays: NoteDay[];
}) {
  switch (action.kind) {
    case "start":
      // The one solid red commit action on the screen: the tap records the start (§14.1).
      return <StartDayButton size="sm" />;
    case "end":
      return <EndDayButton size="sm" />;
    case "working":
      return <WorkingTodayButton label={action.label} forDate={workDate} size="sm" />;
    case "worked_day_off":
      return (
        <AddNoteButton days={noteDays} initialDate={workDate} label={action.label} size="sm" />
      );
  }
}

/** The strip's tracing for `loading.tsx` (ARCHITECTURE §14.1): one 44px row, dot, text, button. */
export function TodayAttendanceStripSkeleton() {
  return (
    <div
      data-slot="attendance-strip-skeleton"
      aria-hidden
      className="border-border bg-card mb-4 flex min-h-11 items-center gap-2 rounded-lg border px-3"
    >
      <Skeleton className="size-2 shrink-0 rounded-full" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="ml-auto h-8 w-20 shrink-0 rounded-md" />
    </div>
  );
}
