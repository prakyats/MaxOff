import { addISTDays, toISTDate, type ISODate } from "@/core/time";

import { inlineDay } from "./days";
import { byStart, type DayEvent } from "./my-day";

/**
 * The Owner's Today and the Admin's (6.2, 6.3; Kickoff 6 decisions 4–12, 22, 23; PRODUCT §4.7).
 * Pure rules over what the screens read; the screens draw them.
 */

// "Needs you" (people) ------------------------------------------------------------------------------

/** The board's buckets, as the attendance module names them (`BOARD_BUCKETS`). */
export type PeopleBucket = "waiting" | "not_chosen" | "present" | "on_leave" | "absent";

export type BoardPerson = {
  memberId: string;
  endNotRecorded: boolean;
  overtimeFlag: boolean;
};

/**
 * The Owner's Today shows exceptions only (kickoff 6 decision 24, owner 2026-10-07): what is
 * overdue, waiting or wrong; a count rather than a list where possible, one tap to the list;
 * hidden when empty. The attendance card carries the people (its counts, coloured by urgency),
 * so there is no "Needs you" list of people any more; when every section after the card is
 * hidden, this one line stands.
 */
export const OWNER_TODAY_EMPTY = "Nothing else needs you today.";

/**
 * The Owner's "Needs you" (their approvals, first on Today since the refresh, owner 2026-10-09)
 * with nothing waiting: the section stays, with this line, so the screen keeps its shape.
 */
export const OWNER_NEEDS_YOU_EMPTY = "Nothing needs you.";

/** How many waiting items the Owner's "Needs you" shows before "See all N" (decision 5). */
export const OWNER_APPROVALS_SHOWN = 5;

/**
 * The full board's filters (a count on Today opens the board on its group). `end_not_recorded`
 * (decision 24) is not a group of the board but a flag on a person: the board keeps its groups
 * and shows only the people whose end of day was not recorded.
 */
export const PEOPLE_GROUPS = [
  "all",
  "not_chosen",
  "present",
  "on_leave",
  "absent",
  "waiting",
  "end_not_recorded",
] as const;
export type PeopleGroup = (typeof PEOPLE_GROUPS)[number];

export function parsePeopleGroup(value: string | string[] | undefined): PeopleGroup {
  const first = Array.isArray(value) ? value[0] : value;
  return (PEOPLE_GROUPS as readonly string[]).includes(first ?? "")
    ? (first as PeopleGroup)
    : "all";
}

/** The board narrowed to a group: by its bucket, or by the "end not recorded" flag (decision 24). */
export function boardForGroup<T extends BoardPerson>(
  board: readonly { bucket: PeopleBucket; people: readonly T[] }[],
  group: PeopleGroup,
): { bucket: PeopleBucket; people: T[] }[] {
  if (group === "all") return board.map((entry) => ({ ...entry, people: [...entry.people] }));
  if (group === "end_not_recorded") {
    return board.flatMap((entry) => {
      const people = entry.people.filter((person) => person.endNotRecorded);
      return people.length > 0 ? [{ bucket: entry.bucket, people }] : [];
    });
  }
  return board.flatMap((entry) =>
    entry.bucket === group ? [{ bucket: entry.bucket, people: [...entry.people] }] : [],
  );
}

// Today's tasks ---------------------------------------------------------------------------------------

const HANDED_IN = ["submitted", "admin_approved"];

/**
 * "N due today · M handed in" (decision 6): the open tasks whose deadline is today (IST), and how
 * many of them are handed in and waiting for a decision.
 */
export function todaysTasks(
  open: readonly { dueAt: string; state: string }[],
  today: ISODate,
): { due: number; handedIn: number } {
  const due = open.filter((task) => toISTDate(task.dueAt) === today);
  return { due: due.length, handedIn: due.filter((task) => HANDED_IN.includes(task.state)).length };
}

export function todaysTasksLine({ due, handedIn }: { due: number; handedIn: number }): string {
  if (due === 0) return "Nothing due today";
  return `${due} due today · ${handedIn} handed in`;
}

// Overdue and risks / Issues ----------------------------------------------------------------------------

/** One risk row (decisions 6, 10). No scoring and no "risk level": facts, in a fixed order. */
export type Risk =
  | { kind: "overdue"; taskId: string; title: string; dueAt: string; ownerId: string }
  | {
      kind: "not_noted";
      taskId: string;
      title: string;
      /** Who has not noted it, the longest waiting first, with when the clock started. */
      waiting: { memberId: string; since: string }[];
    }
  | {
      kind: "on_leave";
      taskId: string;
      title: string;
      memberId: string;
      date: ISODate;
      leave: "leave" | "half_day" | "comp_leave";
      /** The date is the task's deadline or its event day. */
      on: "due" | "event";
    }
  | { kind: "unreachable"; memberId: string; name: string; openTasks: number };

/** The Owner's risks are empty (decision 22). */
export const RISKS_EMPTY = "Nothing overdue.";

/** How many rows show before "See all" (decision 6). */
export const RISKS_SHOWN = 5;

const RISK_ORDER: Record<Risk["kind"], number> = {
  overdue: 0,
  not_noted: 1,
  on_leave: 2,
  unreachable: 3,
};

/** Overdue first (by deadline), then not noted (longest first), leave (by date), unreachable (by name). */
export function sortRisks(risks: readonly Risk[]): Risk[] {
  const key = (risk: Risk): string => {
    switch (risk.kind) {
      case "overdue":
        return risk.dueAt;
      case "not_noted":
        return risk.waiting[0]?.since ?? "";
      case "on_leave":
        return risk.date;
      case "unreachable":
        return risk.name;
    }
  };
  return [...risks].sort(
    (a, b) =>
      RISK_ORDER[a.kind] - RISK_ORDER[b.kind] ||
      key(a).localeCompare(key(b)) ||
      ("taskId" in a ? a.taskId : a.memberId).localeCompare("taskId" in b ? b.taskId : b.memberId),
  );
}

/** An open task as the risk rules read it. */
export type RiskTask = {
  id: string;
  title: string;
  state: string;
  dueAt: string;
  primaryOwnerId: string;
  createdBy: string;
  approvingAdminId: string | null;
  /** Active assignees only. */
  assigneeIds: readonly string[];
  /** The event day, when the task is an event. */
  eventDate?: ISODate | null;
};

const REVIEW_STATES = ["submitted", "admin_approved"];
const FINAL_STATES = ["completed", "cancelled"];

/**
 * Overdue work still with its people (a task handed in waits in Approvals instead, as on the Tasks
 * tab): open, not handed in, past its deadline at `now`.
 */
export function overdueRisks(tasks: readonly RiskTask[], now: Date): Risk[] {
  return tasks
    .filter(
      (task) =>
        !FINAL_STATES.includes(task.state) &&
        !REVIEW_STATES.includes(task.state) &&
        Date.parse(task.dueAt) < now.getTime(),
    )
    .map((task) => ({
      kind: "overdue",
      taskId: task.id,
      title: task.title,
      dueAt: task.dueAt,
      ownerId: task.primaryOwnerId,
    }));
}

/** Not noted past the Owner escalation (`dashboard_not_noted()`), one row per task. */
export function notNotedRisks(
  rows: readonly { taskId: string; memberId: string; since: string }[],
  titles: ReadonlyMap<string, string>,
): Risk[] {
  const byTask = new Map<string, { memberId: string; since: string }[]>();
  for (const row of rows) {
    const list = byTask.get(row.taskId) ?? [];
    list.push({ memberId: row.memberId, since: row.since });
    byTask.set(row.taskId, list);
  }
  return [...byTask].flatMap(([taskId, waiting]) => {
    const title = titles.get(taskId);
    if (!title) return [];
    return [
      {
        kind: "not_noted" as const,
        taskId,
        title,
        waiting: [...waiting].sort((a, b) => a.since.localeCompare(b.since)),
      },
    ];
  });
}

/** A person's approved leave on a day, as `member_availability()` answers it. */
export type LeaveDay = { memberId: string; day: string; leave: string | null };

const APPROVED_LEAVE = ["leave", "half_day", "comp_leave"] as const;

function approvedLeave(value: string | null): (typeof APPROVED_LEAVE)[number] | null {
  return (APPROVED_LEAVE as readonly string[]).includes(value ?? "")
    ? (value as (typeof APPROVED_LEAVE)[number])
    : null;
}

/**
 * An assignee on approved leave (leave, half day, comp leave; never a pending request) on an open
 * task's deadline day, or its event day when `eventDays` (the Admin's Issues, decision 10), among
 * the days given (the Owner's: today and tomorrow, decision 6). One row per task and person.
 */
export function leaveRisks(
  tasks: readonly RiskTask[],
  leave: readonly LeaveDay[],
  days: { from: ISODate; to: ISODate; eventDays: boolean },
): Risk[] {
  const onLeave = new Map<string, (typeof APPROVED_LEAVE)[number]>();
  for (const row of leave) {
    const kind = approvedLeave(row.leave);
    if (kind) onLeave.set(`${row.memberId}|${row.day}`, kind);
  }
  const risks: Risk[] = [];
  for (const task of tasks) {
    if (FINAL_STATES.includes(task.state)) continue;
    const dates: { date: ISODate; on: "due" | "event" }[] = [
      { date: toISTDate(task.dueAt), on: "due" },
      ...(days.eventDays && task.eventDate ? [{ date: task.eventDate, on: "event" as const }] : []),
    ];
    for (const memberId of task.assigneeIds) {
      const hit = dates.find(
        ({ date }) => date >= days.from && date <= days.to && onLeave.has(`${memberId}|${date}`),
      );
      if (!hit) continue;
      risks.push({
        kind: "on_leave",
        taskId: task.id,
        title: task.title,
        memberId,
        date: hit.date,
        leave: onLeave.get(`${memberId}|${hit.date}`) ?? "leave",
        on: hit.on,
      });
    }
  }
  return risks;
}

/** The Admin's tasks for Issues: the open ones they created or approve (5.4's Admin scope). */
export function adminScope<T extends RiskTask>(tasks: readonly T[], adminId: string): T[] {
  return tasks.filter(
    (task) =>
      !FINAL_STATES.includes(task.state) &&
      (task.createdBy === adminId || task.approvingAdminId === adminId),
  );
}

/** The days the Admin's leave check covers: from today to the furthest date, at most 62 days. */
export function leaveWindow(
  tasks: readonly RiskTask[],
  today: ISODate,
): { from: ISODate; to: ISODate } {
  const last = addISTDays(today, 61);
  let to = today;
  for (const task of tasks) {
    for (const date of [toISTDate(task.dueAt), task.eventDate ?? null]) {
      if (date && date > to && date <= last) to = date;
    }
  }
  return { from: today, to };
}

// Emails held back today (decision 23) ---------------------------------------------------------------

export type HeldEmails = { orgCap: number; memberCap: number };

/**
 * "N emails held back today by the daily limit", naming the limit that held them: the per-person
 * cap (editable in Thresholds) or the org-wide one, the email plan's daily limit, which Settings
 * can't change. Null when none were held.
 */
export function heldEmailsLine(held: HeldEmails): { title: string; detail: string } | null {
  const total = held.orgCap + held.memberCap;
  if (total === 0) return null;
  const title =
    total === 1
      ? "1 email held back today by the daily limit"
      : `${total} emails held back today by the daily limit`;
  const parts: string[] = [];
  if (held.memberCap > 0) {
    parts.push(`${held.memberCap} by the per-person limit, which you can change in Thresholds`);
  }
  if (held.orgCap > 0) {
    parts.push(
      `${held.orgCap} by the organisation's limit: the email plan's daily limit, which can't be changed in Settings`,
    );
  }
  return { title, detail: `${parts.join("; ")}.` };
}

// The events strip (decision 12) -----------------------------------------------------------------------

/** How many days the strip covers (today and the next six) and how many rows it shows. */
export const STRIP_DAYS = 7;
export const STRIP_ROWS = 5;

export type StripDay<T extends DayEvent> = {
  date: ISODate;
  holiday: string | null;
  events: T[];
  /** The Owner's "N on leave" that day; null for an Admin. */
  onLeave: number | null;
};

/**
 * Today and the next six days: event tasks and holidays, at most `STRIP_ROWS` rows (a holiday is a
 * row, each event is a row) in day order, then "Open calendar" when more are left. A day appears
 * only when it has a row, or (the Owner) people on leave.
 */
export function eventsStrip<T extends DayEvent>(input: {
  events: readonly T[];
  holidays: readonly { date: ISODate; name: string }[];
  /** The Owner's: approved leave per person per day (`member_availability()`); null for an Admin. */
  leave: readonly LeaveDay[] | null;
  today: ISODate;
}): { days: StripDay<T>[]; hidden: number } {
  const last = addISTDays(input.today, STRIP_DAYS - 1);
  const sorted = byStart(
    input.events.filter((e) => e.eventDate >= input.today && e.eventDate <= last),
  );
  let budget = STRIP_ROWS;
  let hidden = 0;
  const days: StripDay<T>[] = [];
  for (let offset = 0; offset < STRIP_DAYS; offset++) {
    const date = addISTDays(input.today, offset);
    const holidayName = input.holidays.find((h) => h.date === date)?.name ?? null;
    const dayEvents = sorted.filter((event) => event.eventDate === date);
    const onLeave =
      input.leave === null
        ? null
        : new Set(
            input.leave
              .filter((row) => row.day === date && approvedLeave(row.leave) !== null)
              .map((row) => row.memberId),
          ).size;
    let holiday: string | null = null;
    if (holidayName !== null) {
      if (budget > 0) {
        holiday = holidayName;
        budget -= 1;
      } else hidden += 1;
    }
    const shown = dayEvents.slice(0, budget);
    budget -= shown.length;
    hidden += dayEvents.length - shown.length;
    if (holiday !== null || shown.length > 0 || (onLeave ?? 0) > 0) {
      days.push({ date, holiday, events: shown, onLeave });
    }
  }
  return { days, hidden };
}

export function onLeaveLine(count: number): string {
  return `${count} on leave`;
}

/** "Nothing on the calendar this week." when the strip has no row at all. */
export const STRIP_EMPTY = "Nothing on the calendar in the next 7 days.";

// The Admin's Today (decision 9) ----------------------------------------------------------------------

/** The Admin's Needs you is empty (decision 22). */
export const ADMIN_NEEDS_YOU_EMPTY = "Nothing needs you right now.";

/**
 * Each assigned client's open and overdue labelled tasks (decision 9; cycle progress in 7.3), in
 * the clients' order. Open = not completed or cancelled; overdue = open and past its deadline.
 */
export function clientCounts<C extends { id: string }>(
  clients: readonly C[],
  open: readonly { clientId: string | null; state: string; dueAt: string }[],
  now: Date,
): { client: C; open: number; overdue: number }[] {
  return clients.map((client) => {
    const tasks = open.filter(
      (task) => task.clientId === client.id && !FINAL_STATES.includes(task.state),
    );
    return {
      client,
      open: tasks.length,
      overdue: tasks.filter((task) => Date.parse(task.dueAt) < now.getTime()).length,
    };
  });
}

export function clientCountsLine({ open, overdue }: { open: number; overdue: number }): string {
  const openWords = open === 1 ? "1 open task" : `${open} open tasks`;
  return overdue > 0 ? `${openWords} · ${overdue} overdue` : openWords;
}

// A risk's words -----------------------------------------------------------------------------------

export type RiskWords = {
  title: string;
  detail: string;
  /** The detail's colour: red for "overdue by …" (decision 24), with the red dot beside it. */
  detailTone?: "danger";
  marker: { label: string; tone: "danger" | "attention" };
  href: string;
  icon: "overdue" | "not_noted" | "on_leave" | "unreachable";
};

const LEAVE_PHRASE: Record<"leave" | "half_day" | "comp_leave", string> = {
  leave: "on leave",
  half_day: "on a half day",
  comp_leave: "on comp leave",
};

/** "3 h", "2 days": a span of hours as the lists say it. */
export function spanWords(hours: number): string {
  const whole = Math.max(0, Math.floor(hours));
  if (whole < 48) return `${whole} h`;
  return `${Math.floor(whole / 24)} days`;
}

/** What a risk row says and where it goes (decisions 6, 10). */
export function riskWords(
  risk: Risk,
  context: { nameOf: (memberId: string) => string; today: ISODate; now: Date },
): RiskWords {
  const hoursSince = (instant: string) => (context.now.getTime() - Date.parse(instant)) / 3_600_000;
  switch (risk.kind) {
    case "overdue":
      return {
        title: risk.title,
        detail: `${context.nameOf(risk.ownerId)} · overdue by ${spanWords(hoursSince(risk.dueAt))}`,
        detailTone: "danger",
        marker: { label: "Overdue", tone: "danger" },
        href: `/tasks/${risk.taskId}`,
        icon: "overdue",
      };
    case "not_noted": {
      const first = risk.waiting[0];
      const more = risk.waiting.length > 1 ? ` and ${risk.waiting.length - 1} more` : "";
      const who = first ? context.nameOf(first.memberId) : "Someone";
      return {
        title: risk.title,
        detail:
          `${who}${more} hasn't noted it · ${first ? spanWords(hoursSince(first.since)) : ""}`.trim(),
        marker: { label: "Not noted", tone: "attention" },
        href: `/tasks/${risk.taskId}`,
        icon: "not_noted",
      };
    }
    case "on_leave": {
      const day = inlineDay(risk.date, context.today);
      const when = day === "today" || day === "tomorrow" ? day : `on ${day}`;
      const what = risk.on === "event" ? "the day of the event" : "the day it's due";
      return {
        title: risk.title,
        detail: `${context.nameOf(risk.memberId)} is ${LEAVE_PHRASE[risk.leave]} ${when}, ${what}`,
        marker: { label: "On leave", tone: "attention" },
        href: `/tasks/${risk.taskId}`,
        icon: "on_leave",
      };
    }
    case "unreachable":
      return {
        title: `${risk.name} can't be reached`,
        detail: `No notification has reached them for 2 days · ${
          risk.openTasks === 1 ? "1 open task" : `${risk.openTasks} open tasks`
        }`,
        marker: { label: "Can't be reached", tone: "attention" },
        href: "/settings/notifications",
        icon: "unreachable",
      };
  }
}
