import { formatIST, formatTime, type ISODate } from "@/core/time";

/**
 * Assignment warnings (4.3; WORKFLOWS §3.1 "Assignment warnings", kickoff 4 decisions 11–13).
 * Computed in the dialog from `member_availability()` (an Admin never reads anyone's leave
 * directly, PERMISSIONS §2), shown per person before saving, never blocking; a person kept despite
 * one is sent to `task_create` / `task_update_assignment`, which records it as overridden.
 *
 * - `workload`: the person already has at least `threshold` open tasks due that IST day
 *   (freelancers count).
 * - `overlap`: one of their event tasks overlaps this task's event window (no end = one hour).
 *   Since v6.0 (owner 13 Nov 2026) a date-only event is busy all day: it clashes with every
 *   event that day, and a new date-only event clashes with anything the person has that day.
 * - `on_leave`: approved leave, a half day or comp leave on the deadline's date or the event's,
 *   or a pending request ("Leave requested"). Never for a freelancer: their `leave` is always null.
 */

export type WarningKind = "workload" | "overlap" | "on_leave";

export type LeaveMark = "leave" | "half_day" | "comp_leave" | "requested";

/** One person on one IST day, as `member_availability()` answers it. */
export type AvailabilityDay = {
  memberId: string;
  day: ISODate;
  openTasksDue: number;
  eventBlocks: EventBlock[];
  leave: LeaveMark | null;
};

/**
 * One of a person's event tasks that day, as `member_availability()` answers it (v6.0): the time
 * (no start = a date-only event, busy all day), the task's type and who booked it. Never a title.
 */
export type EventBlock = {
  startAt: string | null;
  endAt: string | null;
  typeName?: string | null;
  bookedById?: string | null;
  bookedByName?: string | null;
};

/** An event's busy window: both instants, the end already defaulted to one hour after the start. */
export type EventWindow = { startAt: string; endAt: string };

export type AssignmentWarning = {
  kind: WarningKind;
  memberId: string;
  /** What the dialog showed, stored with the override (`task_warnings.details`). */
  details: Record<string, string | number>;
  /** The line under the person: "4 tasks already due on 3 Oct". */
  text: string;
};

/** The task as it stands, when editing: its own count and block are no warning against itself. */
export type CurrentAssignment = {
  memberIds: readonly string[];
  dueDate: ISODate;
  eventDate: ISODate | null;
  eventWindow: EventWindow | null;
  /** Not completed or cancelled: only an open task is in the person's count. */
  open: boolean;
};

export type WarningInput = {
  memberIds: readonly string[];
  dueDate: ISODate | null;
  eventDate: ISODate | null;
  eventWindow: EventWindow | null;
  threshold: number;
  availability: readonly AvailabilityDay[];
  current?: CurrentAssignment | undefined;
};

const HOUR_MS = 60 * 60 * 1000;

/** The event window a task blocks: no end = one hour from the start (kickoff 4 decision 12). */
export function eventWindow(startAt: string | null, endAt: string | null): EventWindow | null {
  if (!startAt) return null;
  const end = endAt ?? new Date(Date.parse(startAt) + HOUR_MS).toISOString();
  return { startAt, endAt: end };
}

function overlaps(a: EventWindow, b: EventWindow): boolean {
  return Date.parse(a.startAt) < Date.parse(b.endAt) && Date.parse(b.startAt) < Date.parse(a.endAt);
}

function sameWindow(a: EventWindow, b: EventWindow): boolean {
  return (
    Date.parse(a.startAt) === Date.parse(b.startAt) && Date.parse(a.endAt) === Date.parse(b.endAt)
  );
}

/** A timed block's window; null for a date-only one (busy all day). */
function blockWindow(block: EventBlock): EventWindow | null {
  return block.startAt ? eventWindow(block.startAt, block.endAt) : null;
}

/**
 * The person's blocks that clash with an event on the same day (v6.0): `window` null is a
 * date-only event, which clashes with every block; a date-only block clashes with every window.
 * `own` drops this task's own block, once, when editing and the event has not moved.
 */
export function clashingBlocks(
  blocks: readonly EventBlock[],
  window: EventWindow | null,
  options: { own: { window: EventWindow | null } | null },
): EventBlock[] {
  const rest = [...blocks];
  if (options.own) {
    const own = options.own.window;
    const at = rest.findIndex((block) => {
      const other = blockWindow(block);
      return own === null ? other === null : other !== null && sameWindow(other, own);
    });
    if (at >= 0) rest.splice(at, 1);
  }
  return rest.filter((block) => {
    const other = blockWindow(block);
    return window === null || other === null || overlaps(other, window);
  });
}

function dayLabel(date: ISODate): string {
  // Noon IST names the day without any risk of a timezone edge.
  return formatIST(`${date}T12:00:00+05:30`, "d MMM");
}

function timeLabel(instant: string): string {
  return formatTime(instant);
}

const LEAVE_TEXT: Record<LeaveMark, string> = {
  leave: "On leave",
  half_day: "On a half day",
  comp_leave: "On comp leave",
  requested: "Leave requested",
};

/**
 * The warnings for each person, in the order of `memberIds`, then workload, overlap, leave. One
 * of each kind per person at most (the deadline's day first for leave, then the event's).
 */
export function assignmentWarnings(input: WarningInput): AssignmentWarning[] {
  const byKey = new Map<string, AvailabilityDay>();
  for (const row of input.availability) byKey.set(`${row.memberId}|${row.day}`, row);
  const current = input.current;
  const warnings: AssignmentWarning[] = [];

  for (const memberId of input.memberIds) {
    const wasOn = current?.open === true && current.memberIds.includes(memberId);

    if (input.dueDate) {
      const row = byKey.get(`${memberId}|${input.dueDate}`);
      if (row) {
        // Editing: this task is already in their count on its current day.
        const own = wasOn && current?.dueDate === input.dueDate ? 1 : 0;
        const others = Math.max(0, row.openTasksDue - own);
        if (others >= input.threshold) {
          warnings.push({
            kind: "workload",
            memberId,
            details: { date: input.dueDate, open_tasks: others, threshold: input.threshold },
            text: `${others} ${others === 1 ? "task" : "tasks"} already due on ${dayLabel(input.dueDate)}`,
          });
        }
      }
    }

    if (input.eventDate) {
      const row = byKey.get(`${memberId}|${input.eventDate}`);
      if (row) {
        const clash = clashingBlocks(row.eventBlocks, input.eventWindow, {
          own:
            wasOn && current?.eventDate === input.eventDate
              ? { window: current.eventWindow }
              : null,
        })[0];
        const window = clash ? blockWindow(clash) : null;
        if (clash && window) {
          warnings.push({
            kind: "overlap",
            memberId,
            details: { date: input.eventDate, start_at: window.startAt, end_at: window.endAt },
            text: `Busy ${timeLabel(window.startAt)} – ${timeLabel(window.endAt)} on ${dayLabel(input.eventDate)}`,
          });
        } else if (clash) {
          warnings.push({
            kind: "overlap",
            memberId,
            details: { date: input.eventDate, all_day: "true" },
            text: `Busy all day on ${dayLabel(input.eventDate)}`,
          });
        }
      }
    }

    const leaveDays = [input.dueDate, input.eventDate].filter(
      (day, index, days): day is ISODate => day !== null && days.indexOf(day) === index,
    );
    for (const day of leaveDays) {
      const leave = byKey.get(`${memberId}|${day}`)?.leave ?? null;
      if (!leave) continue;
      warnings.push({
        kind: "on_leave",
        memberId,
        details: { date: day, leave },
        text: `${LEAVE_TEXT[leave]} on ${dayLabel(day)}`,
      });
      break;
    }
  }
  return warnings;
}

/** The IST days a check needs availability for: the deadline's and the event's. */
export function availabilityDays(dueDate: ISODate | null, eventDate: ISODate | null): ISODate[] {
  return [dueDate, eventDate].filter(
    (day, index, days): day is ISODate => day !== null && days.indexOf(day) === index,
  );
}

/**
 * Which warnings an edit records (4B): the people added, and everyone kept when the deadline's
 * day or the event's time moved. A warning about someone already on the task, for a day that did
 * not change, was the creator's call at the time and is not recorded again.
 */
export function warningsToRecord(
  warnings: readonly AssignmentWarning[],
  change: { added: readonly string[]; datesMoved: boolean },
): AssignmentWarning[] {
  if (change.datesMoved) return [...warnings];
  return warnings.filter((warning) => change.added.includes(warning.memberId));
}

/** The shape `task_create` and `task_update_assignment` take (`warnings` jsonb). */
export function warningsPayload(
  warnings: readonly AssignmentWarning[],
): { kind: WarningKind; member_id: string; details: Record<string, string | number> }[] {
  return warnings.map((warning) => ({
    kind: warning.kind,
    member_id: warning.memberId,
    details: warning.details,
  }));
}
