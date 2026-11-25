import { clockWords } from "@/core/time/clock-words";

import { lateChip } from "./hours";

/**
 * "Stay until", set ahead of time (v7.0; owner 12 Nov, Q1-Q4 25 Nov 2026; WORKFLOWS §1; the
 * approved sample `docs/design/v70-clear-late-sample.html` screens 4-6) and Clear Late's words
 * (screens 1-3). The rules are the database's (`attendance_stay_plan_set`, `app.apply_stay_plan`,
 * `attendance_clear_late`); this only words them. Pure and date-fns-free (the strip's and the late
 * sheet's client code reads it too), so it is unit-tested.
 */

/** One Stay until set ahead and still waiting for its day (`attendance_stay_plans`, live). */
export type StayPlan = {
  id: string;
  /** The IST date it is for. */
  workDate: string;
  /** The instant the day ends instead. */
  until: string;
  /**
   * An approved leave covers the date (a full day or the afternoon off): the plan will not be
   * applied when the day starts (`app.apply_stay_plan`), "Not used: on leave".
   */
  onLeave: boolean;
};

/** An approved leave, as the "Not used: on leave" check needs it. */
export type ApprovedLeave = { startDate: string; endDate: string; half: string | null };

/** Whether an approved leave keeps the plan's date from using it (a full day, or the afternoon). */
export function planOnLeave(workDate: string, leaves: readonly ApprovedLeave[]): boolean {
  return leaves.some(
    (leave) =>
      leave.startDate <= workDate &&
      workDate <= leave.endDate &&
      (leave.half === null || leave.half === "afternoon"),
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** "Fri 28 Nov" for an ISO date (a calendar date: no time zone is involved). */
export function planDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const at = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  return `${WEEKDAYS[at.getUTCDay()]} ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
}

/** "Fri 28 Nov · until 8:00 pm" (sample screen 4), or "Today · until 8:00 pm". */
export function planLine(plan: Pick<StayPlan, "workDate" | "until">, today: string): string {
  const day = plan.workDate === today ? "Today" : planDay(plan.workDate);
  return `${day} · until ${clockWords(new Date(plan.until))}`;
}

/** The first word of a name: "Prishit" for "Prishit Shetty". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * "Stay until 8:00 pm today (set by Prishit)": the morning strip's line (sample screen 6), before
 * the day starts. Once started, the day's own end line says it (`hoursStrip`). Only the Owner sets
 * one (`attendance.decide`), so a name the person's directory does not hold reads "the Owner".
 */
export function stayPlanStripLine(until: string, setBy: string | null): string {
  return `Stay until ${clockWords(new Date(until))} today (set by ${setBy ? firstName(setBy) : "the Owner"})`;
}

/** A Late day the phone tried to start with no network, for the Owner's Clear Late (Approvals). */
export type LateNoNetwork = {
  dayId: string;
  memberId: string;
  memberName: string;
  memberAvatarFileId: string | null;
  workDate: string;
  startedAt: string;
  lateMinutes: number;
  /** The phone's first try, by the phone's clock (a note, never the record). */
  triedAt: string;
};

/** "Tried at 9:58 am, no network (phone time)" (sample screen 3). */
export function triedLine(triedAt: string): string {
  return `Tried at ${clockWords(new Date(triedAt))}, no network (phone time)`;
}

/** "No network. First tried 9:58 am (phone time)": the late sheet's reason (sample screen 2). */
export function offlineTryReason(triedAt: string): string {
  return `No network. First tried ${clockWords(new Date(triedAt))} (phone time)`;
}

/**
 * The reason Clear Late writes (`attendance_clear_late`), for the cleared row until the list is
 * read again: "No network at the start; tried 9:58 am by the phone's clock."
 */
export function clearedReason(triedAt: string): string {
  return `No network at the start; tried ${clockWords(new Date(triedAt))} by the phone's clock.`;
}

/**
 * A "Late, no network" row's words (sample screen 3): "Started 10:22 am" (with the day before it
 * when it is not today), "Late 22 min", the try, and the reason a Clear Late writes.
 */
export function lateNoNetworkWords(
  day: LateNoNetwork,
  today: string,
): { started: string; lateChip: string; tried: string; clearedReason: string } {
  const started = `Started ${clockWords(new Date(day.startedAt))}`;
  return {
    started: day.workDate === today ? started : `${planDay(day.workDate)} · ${started}`,
    lateChip: lateChip(day.lateMinutes),
    tried: triedLine(day.triedAt),
    clearedReason: clearedReason(day.triedAt),
  };
}
