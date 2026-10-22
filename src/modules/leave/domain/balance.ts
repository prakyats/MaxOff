import type { LeaveType } from "./requests";

/**
 * The balance strip on Attendance & leave (PP-crew-1, V5b): the leave taken so far this IST
 * month, from the member's approved leave (`listApprovedLeaveBetween`, the read My Day already
 * uses). Each request counts its calendar days within the month up to today, both ends included,
 * the way a request's own title counts them ("Leave · 3 days"); a half day counts ½. Pure.
 */
export function leaveTakenThisMonth(
  spans: readonly { type: LeaveType; startDate: string; endDate: string }[],
  today: string,
): number {
  const monthStart = `${today.slice(0, 7)}-01`;
  let days = 0;
  for (const span of spans) {
    const from = span.startDate > monthStart ? span.startDate : monthStart;
    const to = span.endDate < today ? span.endDate : today;
    if (from > to) continue;
    if (span.type === "half_day") {
      days += 0.5;
      continue;
    }
    days +=
      Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) +
      1;
  }
  return days;
}
