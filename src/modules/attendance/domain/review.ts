import type { AttendanceChoice, AttendanceState, DayStatus, LeaveType } from "./choices";
import { STATUS_LABELS } from "./choices";
import { clockTime, firstName, historyDate } from "./history";

/**
 * The Owner's side of attendance (task 2.4, WORKFLOWS §1 "Settled in 2.4"): the days waiting in
 * Approvals, and today's card and people board.
 */

/** A day waiting for the Owner (`pending_review`), as the Attendance group shows it. */
export type PendingDay = {
  id: string;
  memberId: string;
  memberName: string;
  workDate: string;
  submittedChoice: AttendanceChoice | null;
  /** The 23:59 job's proposed absence (2.5), or the approved-leave day on "I'm working today". */
  finalStatus: DayStatus | null;
  proposedBySystem: boolean;
  /** The member said they were working on a day of approved leave. */
  onApprovedLeave: boolean;
  isDayOff: boolean;
  firstLoginAt: string | null;
  note: string | null;
  submittedAt: string | null;
};

/** What approving the day would record: the choice, or the proposed absence. */
export function pendingOutcome(
  day: Pick<PendingDay, "submittedChoice" | "finalStatus">,
): DayStatus {
  return day.submittedChoice ?? day.finalStatus ?? "absent";
}

/** "Present", "Absent (proposed)", "Present on a leave day". */
export function pendingLabel(day: PendingDay): string {
  if (day.submittedChoice === null) return `${STATUS_LABELS.absent} (proposed)`;
  const label = STATUS_LABELS[day.submittedChoice];
  if (day.onApprovedLeave && day.submittedChoice === "present") return `${label} on a leave day`;
  if (day.isDayOff && day.submittedChoice === "present") return `${label} on a day off`;
  return label;
}

/** The row's second line: the date, and when they signed in. */
export function pendingSubtitle(day: PendingDay, today: string): string {
  const date = day.workDate === today ? "Today" : historyDate(day.workDate);
  return day.firstLoginAt ? `${date} · in at ${clockTime(day.firstLoginAt)}` : date;
}

/** "Approved Asha's present", for the Undo toast. */
export function approvedLabel(day: PendingDay): string {
  return `Approved ${firstName(day.memberName)}'s ${STATUS_LABELS[pendingOutcome(day)].toLowerCase()}`;
}

/** Oldest first inside the group (PRODUCT "Approvals"): by date, then by when it was sent. */
export function sortPending<T extends Pick<PendingDay, "workDate" | "submittedAt" | "id">>(
  days: readonly T[],
): T[] {
  return [...days].sort(
    (a, b) =>
      a.workDate.localeCompare(b.workDate) ||
      (a.submittedAt ?? "").localeCompare(b.submittedAt ?? "") ||
      a.id.localeCompare(b.id),
  );
}

/** One row of `attendance_today()` (DATA-MODEL §3). */
export type TodayPerson = {
  memberId: string;
  name: string;
  jobTitle: string | null;
  /** Attendance has begun (the IST day after joining). */
  started: boolean;
  dayId: string | null;
  state: AttendanceState | null;
  finalStatus: DayStatus | null;
  submittedChoice: AttendanceChoice | null;
  firstLoginAt: string | null;
  lastLogoutAt: string | null;
  logoutNotRecorded: boolean;
  overtimeFlag: boolean;
  isDayOff: boolean;
  onLeave: boolean;
  leaveType: LeaveType | null;
};

/** The card's four counts, in the order the Owner acts on them (owner decision 2026-09-24). */
export const TODAY_BUCKETS = ["waiting", "not_chosen", "present", "on_leave"] as const;
export type TodayBucket = (typeof TODAY_BUCKETS)[number];

/**
 * The board's groups: the card's four, then **Absent** (a decided absence needs nothing from
 * the Owner, but the board never drops anyone; owner decision 2026-09-24).
 */
export const BOARD_BUCKETS = [...TODAY_BUCKETS, "absent"] as const;
export type BoardBucket = (typeof BOARD_BUCKETS)[number];

export const TODAY_BUCKET_LABELS: Record<BoardBucket, string> = {
  waiting: "Waiting for a decision",
  not_chosen: "Not chosen yet",
  present: "Present",
  on_leave: "On leave",
  absent: "Absent",
};

const LEAVE_STATUSES: readonly DayStatus[] = ["leave", "half_day", "comp_leave"];

/**
 * Whether the person is expected today: attendance has started (not their joining day), and it
 * is a working day or they came in anyway. Everyone expected is on the board exactly once.
 */
export function expectedToday(person: TodayPerson): boolean {
  return person.started && (!person.isDayOff || person.dayId !== null);
}

/**
 * Where one person sits today, or null when they are not expected (`expectedToday`). A decided
 * absence is `absent`: on the board, not on the card. Waiting beats everything: a Present on a
 * leave day waits for the Owner like any other.
 */
export function todayBucket(person: TodayPerson): BoardBucket | null {
  if (!expectedToday(person)) return null;
  if (person.state === "pending_review") return "waiting";
  const outcome = person.finalStatus;
  if (person.state === "approved" || person.state === "corrected") {
    if (outcome === "present") return "present";
    if (outcome !== null && LEAVE_STATUSES.includes(outcome)) return "on_leave";
    return "absent";
  }
  // No choice yet (no day, or awaiting_choice): approved leave covers them, or they are expected.
  if (person.onLeave && person.dayId === null) return "on_leave";
  return "not_chosen";
}

export type TodaySummary = {
  isDayOff: boolean;
  /** The card's four counts; the Absent group is the board's only. */
  counts: Record<TodayBucket, number>;
  /** Everyone expected today, grouped in `BOARD_BUCKETS` order, by name within each. */
  board: { bucket: BoardBucket; people: TodayPerson[] }[];
};

/**
 * The card and the board from one read. On a day off the card says "Day off" and counts only
 * those who came in: `todayBucket` already leaves out whoever did not.
 */
export function summariseToday(people: readonly TodayPerson[], isDayOff: boolean): TodaySummary {
  const counts: Record<TodayBucket, number> = {
    waiting: 0,
    not_chosen: 0,
    present: 0,
    on_leave: 0,
  };
  const grouped = new Map<BoardBucket, TodayPerson[]>(BOARD_BUCKETS.map((b) => [b, []]));
  for (const person of people) {
    const bucket = todayBucket(person);
    if (bucket === null) continue;
    if (bucket !== "absent") counts[bucket] += 1;
    grouped.get(bucket)?.push(person);
  }
  const board = BOARD_BUCKETS.flatMap((bucket) => {
    const list = (grouped.get(bucket) ?? []).sort(
      (a, b) => a.name.localeCompare(b.name) || a.memberId.localeCompare(b.memberId),
    );
    return list.length > 0 ? [{ bucket, people: list }] : [];
  });
  return { isDayOff, counts, board };
}

/** The status word on a board row: the day's outcome or choice, never a raw state. */
export function boardStatus(person: TodayPerson, bucket: BoardBucket): string {
  if (bucket === "waiting") {
    return person.submittedChoice
      ? STATUS_LABELS[person.submittedChoice]
      : `${STATUS_LABELS.absent} (proposed)`;
  }
  if (bucket === "on_leave") {
    const status = person.finalStatus ?? person.leaveType;
    return status ? STATUS_LABELS[status] : STATUS_LABELS.leave;
  }
  if (bucket === "not_chosen") return person.dayId ? "Signed in" : "Not signed in";
  if (bucket === "absent") return STATUS_LABELS.absent;
  return STATUS_LABELS.present;
}

/** Login, logout and the day's flags, for the board row's second line. */
export function boardDetail(person: TodayPerson): string {
  const parts: string[] = [];
  if (person.firstLoginAt) parts.push(`In ${clockTime(person.firstLoginAt)}`);
  if (person.lastLogoutAt) parts.push(`Out ${clockTime(person.lastLogoutAt)}`);
  if (person.logoutNotRecorded) parts.push("Logout not recorded");
  if (person.overtimeFlag) parts.push("Overtime");
  if (person.isDayOff && person.firstLoginAt) parts.push("Day off");
  return parts.join(" · ") || (person.jobTitle ?? "");
}
