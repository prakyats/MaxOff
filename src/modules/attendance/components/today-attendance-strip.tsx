import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { addISTDays } from "@/core/time";

import { FollowUpHost } from "@/core/ui/composites/follow-up";
import { StatusDot } from "@/core/ui/composites/status-badge";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { getOwnToday } from "../data/attendance";
import { getNoteDays, hasOvertimeNote } from "../data/notes";
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
export async function TodayAttendanceStrip({
  endDayFollowUp,
}: {
  /** The expense claim form End day opens after "Yes" (3b.3; the page hands it over). */
  endDayFollowUp?: ReactNode;
} = {}) {
  const today = await getOwnToday();
  const strip = describeTodayStrip(today);
  // A day off offers the "I worked today" note (3b.2), whose dialog needs the last 8 days' kinds.
  const noteDays = strip.action?.kind === "worked_day_off" ? await getNoteDays(today.workDate) : [];
  // End day offers the overtime note only while the day it ends has none: a second note would
  // refuse the whole End day (one note per day and kind).
  const endsOn = strip.kind === "end_yesterday" ? addISTDays(today.workDate, -1) : today.workDate;
  const noteTaken = strip.action?.kind === "end" ? await hasOvertimeNote(endsOn) : false;

  const content = (
    <div
      data-slot="attendance-strip"
      data-kind={strip.kind}
      className="border-border bg-card mb-4 flex min-h-11 flex-wrap items-center gap-2 rounded-lg border pr-1"
    >
      <Link
        href={HISTORY_HREF}
        aria-label={`Today's attendance: ${strip.text}`}
        className="pressable-row focus-visible:ring-ring flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg pl-3 outline-none select-none focus-visible:ring-2"
      >
        <StatusDot status={strip.dot} label="" className="shrink-0" />
        <span data-slot="attendance-status" className="truncate text-sm font-medium">
          {strip.text}
        </span>
        {strip.action ? null : (
          <ChevronRightIcon className="text-muted-foreground ml-auto size-4 shrink-0" aria-hidden />
        )}
      </Link>
      {/* `contents`: the action's buttons sit in the strip itself (each keeps its size), and a
          slow or failed line after Start day wraps to a full row under the strip's text rather
          than widening the cell past a phone's width (v1.0.0 review). */}
      {strip.action ? (
        <div className="contents">
          <StripActionButton
            action={strip.action}
            workDate={today.workDate}
            noteDays={noteDays}
            yesterday={strip.kind === "end_yesterday"}
            noteTaken={noteTaken}
            endsOn={endsOn}
          />
        </div>
      ) : null}
    </div>
  );
  // The host keeps End day's follow-up (the expense claim form) mounted and open across the
  // refresh that removes End day itself once the day has ended.
  return endDayFollowUp ? <FollowUpHost node={endDayFollowUp}>{content}</FollowUpHost> : content;
}

function StripActionButton({
  action,
  workDate,
  noteDays,
  yesterday,
  noteTaken,
  endsOn,
}: {
  action: StripAction;
  workDate: string;
  noteDays: NoteDay[];
  /** The open day is yesterday's (worked past midnight): End day's copy says so. */
  yesterday: boolean;
  /** The day End day closes already has an overtime note. */
  noteTaken: boolean;
  endsOn: string;
}) {
  switch (action.kind) {
    case "start":
      // The one solid red commit action on the screen: the tap records the start (§14.1).
      return <StartDayButton size="sm" statusClassName="basis-full px-3 pb-2" />;
    case "end":
      return <EndDayButton size="sm" yesterday={yesterday} noteTaken={noteTaken} endsOn={endsOn} />;
    case "working":
      return <WorkingTodayButton size="sm" />;
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
