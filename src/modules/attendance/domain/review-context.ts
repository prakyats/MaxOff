import { addISTDays, formatIST, istDayStart, istWeekday, type ISODate } from "@/core/time";

import type { AttendanceChoice, AttendanceState, DayStatus } from "./choices";
import { STATUS_LABELS } from "./choices";

/**
 * The context beside an attendance day in the Owner's Review panel (B4, UX review 2026-10-21):
 * the person's week around the day and their comp leave balance, so the Owner decides with what
 * they would otherwise open the person's history for. Only what the Owner already sees there
 * (attendance is the Owner's to decide; RLS `attendance.view_all`). Pure, unit-tested.
 */

/** One of the person's days as the week reads it. */
export type ContextDay = {
  workDate: ISODate;
  state: AttendanceState;
  submittedChoice: AttendanceChoice | null;
  finalStatus: DayStatus | null;
};

export type WeekDay = {
  date: ISODate;
  /** "Mon 19". */
  label: string;
  /** "Present", "Absent (proposed)", "Leave · waiting", "No record". */
  status: string;
  /** The colour key for the shared status → colour map (`attendanceStatus`). */
  dot: { status: string | null; undecided: boolean };
  /** The day under review. */
  current: boolean;
};

export type ReviewContext = {
  week: WeekDay[];
  /** "1 day · use by 30 Oct", or "None". */
  compLeave: string;
};

/** The IST week (Monday to Sunday) that holds a date. */
export function weekAround(date: ISODate): { from: ISODate; to: ISODate } {
  const back = (istWeekday(date) + 6) % 7;
  const from = addISTDays(date, -back);
  return { from, to: addISTDays(from, 6) };
}

/** What a day reads: its outcome once decided, the choice (or proposal) while it waits. */
export function contextStatus(day: ContextDay | undefined): string {
  if (!day || day.state === "awaiting_choice") return "No record";
  if (day.state === "pending_review") {
    if (day.submittedChoice === null) return `${STATUS_LABELS.absent} (proposed)`;
    return `${STATUS_LABELS[day.submittedChoice]} · waiting`;
  }
  return day.finalStatus ? STATUS_LABELS[day.finalStatus] : "Recorded";
}

/**
 * The week's seven days, Monday first, up to today (days after today are left out: nothing to
 * read yet). The reviewed day is marked.
 */
export function reviewWeek(
  days: readonly ContextDay[],
  workDate: ISODate,
  today: ISODate,
): WeekDay[] {
  const byDate = new Map(days.map((day) => [day.workDate, day]));
  const { from } = weekAround(workDate);
  const week: WeekDay[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addISTDays(from, offset);
    if (date > today && date !== workDate) break;
    const day = byDate.get(date);
    week.push({
      date,
      label: formatIST(istDayStart(date), "EEE d"),
      status: contextStatus(day),
      dot: day
        ? {
            status: day.finalStatus ?? day.submittedChoice ?? null,
            undecided: day.state === "pending_review" || day.state === "awaiting_choice",
          }
        : { status: "none", undecided: false },
      current: date === workDate,
    });
  }
  return week;
}
