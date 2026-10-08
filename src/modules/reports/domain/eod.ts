import { z } from "zod";

import {
  addISTDays,
  formatIST,
  isISODate,
  istDayStart,
  type ISODate,
  toISTTime,
} from "@/core/time";

/**
 * The end-of-day report (6.5; Kickoff 6 decisions 16–18; WORKFLOWS §8a; ADR-0007 amendment
 * 2026-10-01): what `app.eod_report_payload()` writes for a day (the saved row, or the live view
 * through `eod_report_preview()`), checked here, and the rules of when a day is live, saved or
 * still to come. No money, ever: the schema has no amount and the page shows counts, names, times
 * and titles only. Pure (ADR-0011).
 */

const count = z.number().int().min(0);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instant = z.string().min(1);

const taskItem = z.object({
  id: z.uuid(),
  title: z.string().max(500),
  owner: z.string().max(200),
  freelance: z.boolean().default(false),
  due_at: instant.optional(),
  late_reason: z.string().max(2000).nullable().optional(),
  since: instant.optional(),
  reason: z.string().max(2000).nullable().optional(),
});

const taskGroup = z.object({
  count,
  freelance: count.default(0),
  more: count.default(0),
  items: z.array(taskItem).max(50).default([]),
});

export const eodReportSchema = z.object({
  date: isoDate,
  day_off: z
    .object({ holiday: z.string().max(200).nullable(), weekly_off: z.boolean() })
    .default({ holiday: null, weekly_off: false }),
  attendance: z.object({
    counts: z.object({
      present: count,
      on_leave: count,
      absent: count,
      proposed_absent: count,
      waiting: count,
      end_not_recorded: count,
      overtime: count,
    }),
    people: z.array(
      z.object({
        member_id: z.uuid(),
        name: z.string().max(200),
        status: z.enum(["present", "leave", "half_day", "comp_leave", "absent"]).nullable(),
        waiting: z.boolean(),
        proposed: z.boolean(),
        started_at: instant.nullable(),
        ended_at: instant.nullable(),
        end_not_recorded: z.boolean(),
        overtime: z.boolean(),
        overtime_reason: z.string().max(2000).nullable(),
      }),
    ),
  }),
  decisions: z.object({
    attendance: count,
    leave: z.object({ approved: count, rejected: count }),
    comp_leave: z.object({ granted: count, revoked: count, reviewed: count }),
    expense_claims: count,
  }),
  tasks: z.object({
    completed: taskGroup,
    handed_in: taskGroup,
    overdue: taskGroup,
    cancelled: taskGroup,
    created: taskGroup,
  }),
  approvals: z.array(
    z.object({
      reviewer_id: z.uuid().nullable(),
      name: z.string().max(200),
      step: z.enum(["admin", "owner"]),
      approved: count,
      changes_requested: count,
    }),
  ),
  tomorrow: z.object({
    date: isoDate,
    events: z.array(
      z.object({
        id: z.uuid(),
        title: z.string().max(500),
        start_at: instant.nullable(),
        end_at: instant.nullable(),
        location: z.string().max(500).nullable(),
        people: z.array(z.string().max(200)),
      }),
    ),
  }),
});

export type EodReport = z.infer<typeof eodReportSchema>;
export type EodTaskGroup = EodReport["tasks"]["completed"];
export type EodPerson = EodReport["attendance"]["people"][number];

/** The payload, checked; null when it is not a report (the page shows an error, never a crash). */
export function parseEodReport(value: unknown): EodReport | null {
  const parsed = eodReportSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// When a day is live, saved or still to come ---------------------------------------------------------

/**
 * How the page reads a date (decision 17): today is live; yesterday is live until the End-day
 * cutoff has passed (a late End day for it is still allowed until then), saved after; an earlier
 * date shows its saved row only; a later date has not come.
 */
export type EodDayState = "today" | "yesterday_live" | "saved" | "future";

export function eodDayState(input: {
  date: ISODate;
  today: ISODate;
  /** `org_settings.end_day_cutoff_time`, "HH:MM". */
  cutoff: string;
  now: Date;
}): EodDayState {
  if (input.date > input.today) return "future";
  if (input.date === input.today) return "today";
  if (input.date === addISTDays(input.today, -1) && toISTTime(input.now) < input.cutoff) {
    return "yesterday_live";
  }
  return "saved";
}

/** "5:00 AM": the cutoff as a clock time (12-hour, IST). */
export function cutoffWords(cutoff: string): string {
  const [h = "0", m = "0"] = cutoff.split(":");
  const hours = Number(h);
  const minutes = Number(m);
  const suffix = hours < 12 ? "AM" : "PM";
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

/** The note under a live day: what it is and when it saves. */
export function liveNote(state: EodDayState, cutoff: string): string | null {
  if (state === "today") return "Live: today so far. It saves tomorrow morning.";
  if (state === "yesterday_live") return `Live until it saves at ${cutoffWords(cutoff)}.`;
  return null;
}

/**
 * The note under a saved day, in the live note's place, so a day's page has the same lines live
 * or saved and its loading screen traces both: "Saved 7 Oct, 5:00 am."
 */
export function savedNote(generatedAt: string): string {
  return `Saved ${formatIST(generatedAt, "d MMM, h:mm aaa")}.`;
}

/** "Today · Tue 7 Oct 2026", "Yesterday · …", else "Mon 5 Oct 2026". */
export function eodDateHeading(date: ISODate, today: ISODate): string {
  const full = formatIST(istDayStart(date), "EEE d MMM yyyy");
  if (date === today) return `Today · ${full}`;
  if (date === addISTDays(today, -1)) return `Yesterday · ${full}`;
  return full;
}

/** The address of a day's report. */
export function eodHref(date: ISODate): string {
  return `/reports/end-of-day/${date}`;
}

/** A `[date]` route segment, checked: a real IST date or null. */
export function parseEodDate(segment: string | undefined): ISODate | null {
  return segment && isISODate(segment) ? segment : null;
}

// The list -----------------------------------------------------------------------------------------

export type EodListEntry = {
  date: ISODate;
  heading: string;
  /** The second line: live, saving, saved at, or not saved. */
  detail: string;
  state: EodDayState | "missing";
};

export const EOD_PAGE_SIZE = 31;

/**
 * Reports → End of day: today (live) and yesterday (live until the cutoff, else its saved row)
 * first, then the saved history, newest first. A past date without a row (before the job
 * existed, or a day it has not reached yet) is listed as not saved only when it sits between
 * saved rows; the history is what the job wrote.
 */
export function eodListEntries(input: {
  today: ISODate;
  cutoff: string;
  now: Date;
  saved: readonly { date: ISODate; generatedAt: string }[];
}): EodListEntry[] {
  const yesterday = addISTDays(input.today, -1);
  const savedAt = new Map(input.saved.map((row) => [row.date, row.generatedAt]));
  const entries: EodListEntry[] = [];
  const entry = (date: ISODate): EodListEntry => {
    const state = eodDayState({ date, today: input.today, cutoff: input.cutoff, now: input.now });
    const at = savedAt.get(date);
    if (state === "today") {
      return { date, heading: eodDateHeading(date, input.today), detail: "Live, so far", state };
    }
    if (state === "yesterday_live") {
      return {
        date,
        heading: eodDateHeading(date, input.today),
        detail: `Live · saves at ${cutoffWords(input.cutoff)}`,
        state,
      };
    }
    if (at) {
      return {
        date,
        heading: eodDateHeading(date, input.today),
        detail: `Saved ${formatIST(at, "d MMM, h:mm aaa")}`,
        state: "saved",
      };
    }
    return {
      date,
      heading: eodDateHeading(date, input.today),
      detail: "Not saved",
      state: "missing",
    };
  };
  entries.push(entry(input.today));
  entries.push(entry(yesterday));
  for (const row of [...input.saved].sort((a, b) => b.date.localeCompare(a.date))) {
    if (row.date === input.today || row.date === yesterday) continue;
    entries.push(entry(row.date));
  }
  return entries;
}

// Words ---------------------------------------------------------------------------------------------

export const STATUS_WORDS: Record<NonNullable<EodPerson["status"]>, string> = {
  present: "Present",
  leave: "Leave",
  half_day: "Half day",
  comp_leave: "Comp leave",
  absent: "Absent",
};

/** A person's status on the day: "Present", "Absent (proposed)", "Leave · waiting". */
export function personStatus(person: EodPerson): string {
  const base = person.status ? STATUS_WORDS[person.status] : "No choice";
  if (person.proposed) return `${base} (proposed)`;
  if (person.waiting) return `${base} · waiting`;
  return base;
}

/** The day's start and end and its flags, for a person's second line. */
export function personDetail(person: EodPerson): string {
  const parts: string[] = [];
  if (person.started_at) parts.push(`Started ${formatIST(person.started_at, "h:mm aaa")}`);
  if (person.ended_at) parts.push(`Ended ${formatIST(person.ended_at, "h:mm aaa")}`);
  if (person.end_not_recorded) parts.push("End of day not recorded");
  if (person.overtime) {
    parts.push(person.overtime_reason ? `Overtime: ${person.overtime_reason}` : "Overtime");
  }
  return parts.join(" · ");
}

/** "6 present · 1 on leave · 2 absent (1 proposed) · 1 waiting". */
export function attendanceLine(counts: EodReport["attendance"]["counts"]): string {
  const parts = [
    `${counts.present} present`,
    `${counts.on_leave} on leave`,
    counts.proposed_absent > 0
      ? `${counts.absent} absent (${counts.proposed_absent} proposed)`
      : `${counts.absent} absent`,
  ];
  if (counts.waiting > 0) parts.push(`${counts.waiting} waiting`);
  if (counts.end_not_recorded > 0) parts.push(`${counts.end_not_recorded} end not recorded`);
  if (counts.overtime > 0) parts.push(`${counts.overtime} overtime`);
  return parts.join(" · ");
}

/** The decisions as lines, zero lines left out. */
export function decisionLines(decisions: EodReport["decisions"]): string[] {
  const lines: string[] = [];
  const n = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;
  if (decisions.attendance > 0)
    lines.push(n(decisions.attendance, "attendance decision", "attendance decisions"));
  if (decisions.leave.approved > 0)
    lines.push(n(decisions.leave.approved, "leave request approved", "leave requests approved"));
  if (decisions.leave.rejected > 0)
    lines.push(n(decisions.leave.rejected, "leave request rejected", "leave requests rejected"));
  if (decisions.comp_leave.granted > 0)
    lines.push(n(decisions.comp_leave.granted, "comp leave granted", "comp leaves granted"));
  if (decisions.comp_leave.revoked > 0)
    lines.push(n(decisions.comp_leave.revoked, "comp leave taken back", "comp leaves taken back"));
  if (decisions.comp_leave.reviewed > 0)
    lines.push(
      n(decisions.comp_leave.reviewed, "extra work note reviewed", "extra work notes reviewed"),
    );
  if (decisions.expense_claims > 0)
    lines.push(n(decisions.expense_claims, "expense claim decided", "expense claims decided"));
  return lines;
}

/** A task group's heading count: "3", or "3 · 1 freelance" when a freelancer's is among them. */
export function groupCount(group: EodTaskGroup): string {
  return group.freelance > 0 ? `${group.count} · ${group.freelance} freelance` : `${group.count}`;
}

/** A task item's second line, by group. */
export function taskDetail(
  group: "completed" | "handed_in" | "overdue" | "cancelled" | "created",
  item: EodTaskGroup["items"][number],
): string {
  const who = item.freelance ? `${item.owner} (freelancer)` : item.owner;
  switch (group) {
    case "overdue": {
      const due = item.due_at ? `due ${formatIST(item.due_at, "d MMM, h:mm aaa")}` : "";
      const reason = item.late_reason ? `Late: ${item.late_reason}` : "No late reason yet";
      return [who, due, reason].filter(Boolean).join(" · ");
    }
    case "handed_in":
      return item.since ? `${who} · handed in ${formatIST(item.since, "d MMM, h:mm aaa")}` : who;
    case "cancelled":
      return item.reason ? `${who} · ${item.reason}` : who;
    default:
      return who;
  }
}

/** An approver's line: "Approved 3 · Changes requested 1". */
export function approvalDetail(row: EodReport["approvals"][number]): string {
  const parts: string[] = [];
  if (row.approved > 0) parts.push(`Approved ${row.approved}`);
  if (row.changes_requested > 0) parts.push(`Changes requested ${row.changes_requested}`);
  return parts.join(" · ") || "No decision";
}

/** "10:00 am – 12:00 pm · Studio B · Kiran, Lata". */
export function eventDetail(event: EodReport["tomorrow"]["events"][number]): string {
  const time = event.start_at
    ? event.end_at
      ? `${formatIST(event.start_at, "h:mm aaa")} – ${formatIST(event.end_at, "h:mm aaa")}`
      : formatIST(event.start_at, "h:mm aaa")
    : "All day";
  return [time, event.location, event.people.join(", ")].filter(Boolean).join(" · ");
}

/** Whether a report has anything at all to show (a quiet day off says so). */
export function isQuietDay(report: EodReport): boolean {
  const c = report.attendance.counts;
  return (
    report.attendance.people.length === 0 &&
    c.present + c.on_leave + c.absent + c.waiting + c.end_not_recorded + c.overtime === 0 &&
    decisionLines(report.decisions).length === 0 &&
    Object.values(report.tasks).every((group) => group.count === 0) &&
    report.approvals.length === 0 &&
    report.tomorrow.events.length === 0
  );
}
