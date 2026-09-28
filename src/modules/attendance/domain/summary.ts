/**
 * The month summary (PRODUCT §4.18, WORKFLOWS §2b, task 3b.4): one person's IST month as the
 * Owner reads it. The figures come from `month_summary()` (DATA-MODEL §7b), which is the rule;
 * this only names and orders the lines. No salary anywhere: the Owner works out pay.
 */
export type MonthSummary = {
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

/** The lines of PRODUCT §4.18's table, in its order. */
export function summaryLines(summary: MonthSummary): SummaryLine[] {
  const lines: SummaryLine[] = [
    { key: "working", label: "Working days", value: dayFigure(summary.workingDays) },
    {
      key: "worked",
      label: "Days worked",
      value: dayFigure(summary.daysWorked),
      detail: `${summary.presentDays} present · ${summary.halfDays} half ${summary.halfDays === 1 ? "day" : "days"}`,
    },
    {
      key: "leave",
      label: "Leave · Half days · Absent",
      value: `${summary.leaveDays} · ${summary.halfDays} · ${summary.absentDays}`,
    },
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
      value: `${dayFigure(summary.creditsGranted)} · ${dayFigure(summary.creditsUsed)} · ${dayFigure(summary.creditsExpired)}`,
      detail: "Granted · used · expired",
    },
  ];
  return lines;
}

/** "3 days waiting for your review", or null when nothing waits. */
export function pendingText(pendingDays: number): string | null {
  if (pendingDays === 0) return null;
  return `${pendingDays} ${pendingDays === 1 ? "day" : "days"} waiting for your review`;
}
