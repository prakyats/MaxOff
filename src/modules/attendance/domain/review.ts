import type { AttendanceChoice, AttendanceState, DayStatus, LeaveType } from "./choices";
import { STATUS_LABELS } from "./choices";
import { clockTime, historyDate } from "./history";
import { displayName } from "@/core/lib/display-name";
import { formatIST, istDayStart } from "@/core/time";

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
  /** The Start day tap (3b.1). */
  startedAt: string | null;
  note: string | null;
  submittedAt: string | null;
  /**
   * The row's last change: for the 23:59 job's proposed absence (no `submittedAt`), when the job
   * put it in front of the Owner (the Owner's Today's "waiting …", owner 2026-10-09).
   */
  updatedAt: string;
};

/** "Started 9:12 am" (3b.1), or nothing recorded. */
export function pendingStart(day: Pick<PendingDay, "startedAt">): {
  label: "Started";
  value: string;
} {
  if (day.startedAt) return { label: "Started", value: clockTime(day.startedAt) };
  return { label: "Started", value: "Not recorded" };
}

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

/** The row's second line: the date, and when they started. */
export function pendingSubtitle(day: PendingDay, today: string): string {
  const date = day.workDate === today ? "Today" : historyDate(day.workDate);
  return day.startedAt ? `${date} · started ${clockTime(day.startedAt)}` : date;
}

/**
 * The Owner's Today compact row's first meta line, what and when (owner 2026-10-09): "Present ·
 * today, started 10:12", "Absent (proposed) · Thu 8 Oct". Short enough for a 375px row beside its
 * button, so nothing in it is ever cut short; the clock is IST, 24-hour, as This week's events.
 */
export function pendingDetail(day: PendingDay, today: string): string {
  const date = day.workDate === today ? "today" : formatIST(istDayStart(day.workDate), "EEE d MMM");
  const started = day.startedAt ? `, started ${formatIST(day.startedAt, "HH:mm")}` : "";
  return `${pendingLabel(day)} · ${date}${started}`;
}

/** "Approved Asha's present", for the Undo toast. */
export function approvedLabel(day: PendingDay): string {
  return `Approved ${displayName(day.memberName)}'s ${STATUS_LABELS[pendingOutcome(day)].toLowerCase()}`;
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

/** One row of `attendance_today_detail()` (3b.1; DATA-MODEL §3). */
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
  /** The Start day and End day taps (3b.1). */
  startedAt: string | null;
  endedAt: string | null;
  endNotRecorded: boolean;
  overtimeFlag: boolean;
  isDayOff: boolean;
  onLeave: boolean;
  leaveType: LeaveType | null;
};

/**
 * One row of `attendance_today_detail()` or `attendance_end_not_recorded_yesterday()` exactly as
 * PostgREST answers it (the same columns). A person with no day yet has nulls in the day's columns,
 * which the generated types do not say, so every column is read as possibly null.
 */
export type TodayDetailRow = {
  member_id: string | null;
  full_name: string | null;
  job_title: string | null;
  started: boolean | null;
  day_id: string | null;
  state: AttendanceState | null;
  final_status: DayStatus | null;
  submitted_choice: AttendanceChoice | null;
  proposed_by_system?: boolean | null;
  overtime_flag: boolean | null;
  is_day_off: boolean | null;
  on_leave: boolean | null;
  leave_type: LeaveType | null;
  started_at: string | null;
  ended_at: string | null;
  end_not_recorded: boolean | null;
};

/** A row of the day reads as the card and the board use it. */
export function todayPersonFromRow(row: TodayDetailRow): TodayPerson {
  return {
    memberId: row.member_id ?? "",
    name: displayName(row.full_name, ""),
    jobTitle: row.job_title,
    started: row.started ?? false,
    dayId: row.day_id,
    state: row.state,
    finalStatus: row.final_status,
    submittedChoice: row.submitted_choice,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    endNotRecorded: row.end_not_recorded ?? false,
    overtimeFlag: row.overtime_flag ?? false,
    isDayOff: row.is_day_off ?? false,
    onLeave: row.on_leave ?? false,
    leaveType: row.leave_type,
  };
}

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
  // "Not started" everywhere the Owner sees it (kickoff 6 decision 24, owner 2026-10-07).
  not_chosen: "Not started",
  present: "Present",
  on_leave: "On leave",
  absent: "Absent",
};

/**
 * The card's counts (kickoff 6 decision 24, owner 2026-10-07): the four groups, then Absent and
 * "End of day not recorded", shown only above zero. Each is a tap target: Waiting opens Approvals,
 * the others the full board on that group.
 */
export const TODAY_CARD_COUNTS = [
  "not_chosen",
  "waiting",
  "present",
  "on_leave",
  "absent",
  "end_not_recorded",
] as const;
export type TodayCardCount = (typeof TODAY_CARD_COUNTS)[number];

/**
 * The strip: the four groups in one row, always (the owner's preview review, 2026-10-09: "Keep the
 * four counts in one row"): Not started · Waiting · Present · On leave.
 */
export const TODAY_STRIP_COUNTS = [
  "not_chosen",
  "waiting",
  "present",
  "on_leave",
] as const satisfies readonly TodayCardCount[];

/**
 * The problem counts, each one red line under the strip, only above zero (owner 2026-10-09: a
 * fifth count wrapped the strip and its label ran over three lines).
 */
export const TODAY_CARD_LINES = [
  "absent",
  "end_not_recorded",
] as const satisfies readonly TodayCardCount[];
export type TodayCardLine = (typeof TODAY_CARD_LINES)[number];

/**
 * A problem count's red line: "1 didn't end their day yesterday", "2 are absent today". Null at
 * zero (the line is hidden).
 */
export function cardLineWords(line: TodayCardLine, value: number): string | null {
  if (value <= 0) return null;
  if (line === "end_not_recorded") return `${value} didn't end their day yesterday`;
  return `${value} ${value === 1 ? "is" : "are"} absent today`;
}

/** The card's words: the board's, with "Waiting" short enough for a quarter of a phone's row. */
export const TODAY_CARD_LABELS: Record<TodayCardCount, string> = {
  ...TODAY_BUCKET_LABELS,
  waiting: "Waiting",
  end_not_recorded: "End of day not recorded",
};

/**
 * Colour by urgency (decision 24): amber for "have a look" (Not started, Waiting), red for a
 * problem (Absent, End of day not recorded), both only above zero; Present and On leave neutral.
 * Never colour alone: the dot and the label always go with the number.
 */
export type CountTone = "attention" | "danger" | "neutral";
export const TODAY_CARD_TONES: Record<TodayCardCount, CountTone> = {
  waiting: "attention",
  not_chosen: "attention",
  present: "neutral",
  on_leave: "neutral",
  absent: "danger",
  end_not_recorded: "danger",
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
  /**
   * The card's counts: the four groups, the decided absences, and the people whose End day was not
   * recorded **yesterday** and whose day the Owner has not decided yet (decision 24, amended by the
   * owner 2026-10-08: `attendance_end_not_recorded_yesterday()`, from the End-day cutoff on).
   */
  counts: Record<TodayCardCount, number>;
  /** Everyone expected today, grouped in `BOARD_BUCKETS` order, by name within each. */
  board: { bucket: BoardBucket; people: TodayPerson[] }[];
};

/**
 * The card and the board from one read. On a day off the card says "Day off" and counts only
 * those who came in: `todayBucket` already leaves out whoever did not. "End of day not recorded"
 * counts `unendedYesterday` (decision 24 amended, 2026-10-08): yesterday's started days with no End
 * day the Owner has not decided, read from the cutoff on; today's own days never carry the flag
 * (the 00:00 job sets it on the day that ended).
 */
export function summariseToday(
  people: readonly TodayPerson[],
  isDayOff: boolean,
  unendedYesterday: readonly TodayPerson[] = [],
): TodaySummary {
  const counts: Record<TodayCardCount, number> = {
    waiting: 0,
    not_chosen: 0,
    present: 0,
    on_leave: 0,
    absent: 0,
    end_not_recorded: unendedYesterday.length,
  };
  const grouped = new Map<BoardBucket, TodayPerson[]>(BOARD_BUCKETS.map((b) => [b, []]));
  for (const person of people) {
    const bucket = todayBucket(person);
    if (bucket === null) continue;
    counts[bucket] += 1;
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
  if (bucket === "not_chosen") return "Not started";
  if (bucket === "absent") return STATUS_LABELS.absent;
  return STATUS_LABELS.present;
}

/** The day's start and end (the Start day and End day taps) and its flags, for the board row's second line. */
export function boardDetail(person: TodayPerson): string {
  const parts: string[] = [];
  if (person.startedAt) parts.push(`Started ${clockTime(person.startedAt)}`);
  if (person.endedAt) parts.push(`Ended ${clockTime(person.endedAt)}`);
  if (person.endNotRecorded) parts.push("End not recorded");
  if (person.overtimeFlag) parts.push("Overtime");
  if (person.isDayOff && person.startedAt) parts.push("Day off");
  return parts.join(" · ") || (person.jobTitle ?? "");
}
