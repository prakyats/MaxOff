import type { MonthHours, MonthSummary } from "@/modules/attendance";
import type { FactLine } from "@/modules/reports";

/** `monthHoursCounts` from `modules/attendance`, handed in (this file stays pure and testable). */
export type HoursCounts = (
  hours: MonthHours,
) => readonly { key: string; label: string; value: string; detail: string | null }[];

const NO_HOURS: MonthHours = {
  lateDays: 0,
  lateMinutes: 0,
  leftUnanswered: 0,
  earlyLeavesApproved: 0,
  halfDaysMorning: 0,
  halfDaysAfternoon: 0,
};

/** "4", "2½", "½", "0": halves are the only fractions a day count has. */
function days(value: number): string {
  const whole = Math.floor(value);
  if (Math.round((value - whole) * 2) !== 1) return String(whole);
  return whole === 0 ? "½" : `${whole}½`;
}

/**
 * A person's attendance facts in the People report's **Month** view (kickoff 9 decision 13:
 * attendance lines in the Month view only; the refresh's Q5: the working-hours counts per person,
 * never ranked): days worked of the working days, additional leave and comp leave from the Month
 * report's own summary, then its four working-hours counts with their own labels and figures.
 */
export const ATTENDANCE_LINE_COUNT = 7;

export function attendanceLines(summary: MonthSummary, counts: HoursCounts): FactLine[] {
  const lines: FactLine[] = [
    {
      key: "worked",
      label: "Days worked",
      value: `${days(summary.daysWorked)} of ${summary.workingDays}`,
    },
    { key: "additional", label: "Additional leave", value: days(summary.additionalLeave) },
    { key: "comp", label: "Comp leave", value: days(summary.compLeaveDays) },
  ];
  // No counts came back (rules off that month): the same four lines, each "—", so the card keeps
  // its shape.
  const hours = summary.hours ?? NO_HOURS;
  return [
    ...lines,
    ...counts(hours).map((count) => ({
      key: count.key,
      label: count.label,
      value: count.detail ? `${count.value} · ${count.detail}` : count.value,
    })),
  ];
}
