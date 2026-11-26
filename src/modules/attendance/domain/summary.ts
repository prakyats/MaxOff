import type { MonthHours } from "./hours";

/**
 * The month summary (PRODUCT §4.18, WORKFLOWS §2b, task 3b.4): one person's IST month as the
 * Owner reads it. The figures come from `month_summary()` (DATA-MODEL §7b), which is the rule;
 * this only names and orders the lines. No salary anywhere: the Owner works out pay.
 */
export type MonthSummary = {
  /** v1.9 W4: the month counts (`month_summary_hours()`), or null where none came back. */
  hours: MonthHours | null;
  memberId: string;
  fullName: string;
  role: "owner" | "admin" | "staff";
  workingDays: number;
  daysWorked: number;
  presentDays: number;
  leaveDays: number;
  halfDays: number;
  absentDays: number;
  compLeaveDays: number;
  additionalLeave: number;
  daysOffWorked: number;
  pendingDays: number;
  overtimeNotes: number;
  overtimeGranted: number;
  creditsGranted: number;
  creditsUsed: number;
  creditsExpired: number;
};

/** "4", "2½", "½", "0": halves are the only fractions a day count has. */
export function dayFigure(days: number): string {
  const whole = Math.floor(days);
  const half = Math.round((days - whole) * 2) === 1;
  if (!half) return String(whole);
  return whole === 0 ? "½" : `${whole}½`;
}

export type SummaryLine = {
  key: string;
  label: string;
  value: string;
  /** Extra words under the value, e.g. "3 present · 2 half days". */
  detail?: string;
  /** The line the Owner reads first (additional leave: the one that can reduce pay). */
  emphasis?: boolean;
};

/**
 * The half days that were half worked, from the server's own figures: days worked beyond the
 * present days, in halves (a half day, or a ½ comp day, worked its other half). Not `halfDays`:
 * since v2.0.1 a split day (½ comp + ½ leave, nothing worked) is one of the month's half days, and
 * a ½ comp day never was, so "Days worked"'s detail would name halves nobody worked.
 */
export function workedHalfDays(summary: Pick<MonthSummary, "daysWorked" | "presentDays">): number {
  return Math.max(0, Math.round((summary.daysWorked - summary.presentDays) * 2));
}

/** The lines of PRODUCT §4.18's table, in its order. */
export function summaryLines(summary: MonthSummary): SummaryLine[] {
  const workedHalves = workedHalfDays(summary);
  const lines: SummaryLine[] = [
    { key: "working", label: "Working days", value: dayFigure(summary.workingDays) },
    {
      key: "worked",
      label: "Days worked",
      value: dayFigure(summary.daysWorked),
      detail: `${summary.presentDays} present · ${workedHalves} half ${workedHalves === 1 ? "day" : "days"}`,
    },
    // W6 (v1.8 V4): three labelled rows, never "0 · 0 · 10" to decode.
    { key: "leave", label: "Leave", value: dayFigure(summary.leaveDays) },
    { key: "half", label: "Half days", value: String(summary.halfDays) },
    { key: "absent", label: "Absent", value: dayFigure(summary.absentDays) },
    { key: "comp", label: "Comp leave used", value: dayFigure(summary.compLeaveDays) },
    {
      key: "additional",
      label: "Additional leave",
      value: dayFigure(summary.additionalLeave),
      detail: "Leave + ½ × half days + absent. Comp leave never counts.",
      emphasis: true,
    },
    { key: "off", label: "Days off worked", value: dayFigure(summary.daysOffWorked) },
    {
      key: "overtime",
      label: "Overtime notes",
      value: String(summary.overtimeNotes),
      detail: `${summary.overtimeGranted} earned comp leave`,
    },
    {
      key: "credits",
      label: "Comp leave credits",
      // W6: each figure with its word.
      value: dayFigure(summary.creditsGranted),
      detail: `${dayFigure(summary.creditsGranted)} granted · ${dayFigure(summary.creditsUsed)} used · ${dayFigure(summary.creditsExpired)} expired`,
    },
  ];
  return lines;
}

/** "3 days waiting for your review", or null when nothing waits. */
export function pendingText(pendingDays: number): string | null {
  if (pendingDays === 0) return null;
  return `${pendingDays} ${pendingDays === 1 ? "day" : "days"} waiting for your review`;
}
