import { describe, expect, it } from "vitest";

import type { MonthSummary } from "@/modules/attendance";

import { ATTENDANCE_LINE_COUNT, attendanceLines, type HoursCounts } from "./attendance-lines";

/** The Month report's four counts, as `monthHoursCounts` words them ("—" for zero). */
const figure = (n: number) => (n === 0 ? "—" : String(n));
const counts: HoursCounts = (h) => [
  {
    key: "late",
    label: "Late days",
    value: figure(h.lateDays),
    detail: h.lateDays ? `${h.lateMinutes} min in all` : null,
  },
  {
    key: "unanswered",
    label: "Left early, not answered",
    value: figure(h.leftUnanswered),
    detail: null,
  },
  {
    key: "approved",
    label: "Early leaves approved",
    value: figure(h.earlyLeavesApproved),
    detail: null,
  },
  {
    key: "half",
    label: "Half days",
    value: figure(h.halfDaysMorning + h.halfDaysAfternoon),
    detail:
      h.halfDaysMorning + h.halfDaysAfternoon
        ? `${h.halfDaysMorning} morning · ${h.halfDaysAfternoon} afternoon`
        : null,
  },
];

const summary: MonthSummary = {
  hours: null,
  memberId: "m",
  fullName: "Anil",
  role: "staff",
  workingDays: 25,
  daysWorked: 18.5,
  presentDays: 18,
  leaveDays: 1,
  halfDays: 1,
  absentDays: 0,
  compLeaveDays: 0,
  additionalLeave: 1.5,
  daysOffWorked: 0,
  pendingDays: 0,
  overtimeNotes: 0,
  overtimeGranted: 0,
  creditsGranted: 0,
  creditsUsed: 0,
  creditsExpired: 0,
};

describe("the people report's Month attendance lines (decision 13, Q5)", () => {
  it("always seven lines, the counts as '—' when none came back", () => {
    const lines = attendanceLines(summary, counts);
    expect(lines).toHaveLength(ATTENDANCE_LINE_COUNT);
    expect(lines.map((line) => [line.label, line.value])).toEqual([
      ["Days worked", "18½ of 25"],
      ["Additional leave", "1½"],
      ["Comp leave", "0"],
      ["Late days", "—"],
      ["Left early, not answered", "—"],
      ["Early leaves approved", "—"],
      ["Half days", "—"],
    ]);
  });

  it("the working-hours counts with their detail", () => {
    const lines = attendanceLines(
      {
        ...summary,
        hours: {
          lateDays: 2,
          lateMinutes: 35,
          leftUnanswered: 1,
          earlyLeavesApproved: 0,
          halfDaysMorning: 1,
          halfDaysAfternoon: 0,
        },
      },
      counts,
    );
    expect(lines[3]?.value).toMatch(/^2 · /);
    expect(lines[4]?.value).toBe("1");
    expect(lines[6]?.value).toBe("1 · 1 morning · 0 afternoon");
  });
});
