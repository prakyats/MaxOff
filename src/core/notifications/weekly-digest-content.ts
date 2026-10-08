import { z } from "zod";

import { formatIST, istDayStart } from "@/core/time";

import {
  BRAND_RED,
  emailDocument,
  escapeHtml,
  headerSafe,
  type NotificationEmail,
  openUrl,
} from "./email-content";

/**
 * The Owner's weekly summary (6.5, Kickoff 6 decision 23; WORKFLOWS §8 `digest_weekly`): the email
 * `digest_weekly` queues on the Owner's digest day, rendered from the row's payload
 * (`app.digest_weekly_payload`). The week's numbers come only from the seven saved end-of-day
 * reports, each day linking to its report; then "now" (what waits, overdue, can't be reached);
 * then "the week ahead" (leave, events, holidays). Counts only, never an amount (an email can be
 * forwarded). A line at 0 is left out, a section with no line too; when everything is 0 the email
 * says "Nothing needs you this week." (the job skips it then, but a queued row still renders).
 * Pure: the dispatcher hands in the origin; `/diagnostics/digest` renders the same.
 */
export const WEEKLY_DIGEST_KIND = "owner_digest_weekly";

const count = z.number().int().min(0);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const names = z.array(z.string().max(200)).max(5);

const daySchema = z.object({
  date: isoDate,
  report_id: z.uuid().nullable(),
  saved: z.boolean(),
  present: count,
  on_leave: count,
  absent: count,
  end_not_recorded: count,
  overtime: count,
  completed: count,
  cancelled: count,
  created: count,
  decisions: count,
  holiday: z.string().max(200).nullable(),
  weekly_off: z.boolean(),
});

const weeklyDigestSchema = z.object({
  date: isoDate,
  week: z.object({ from: isoDate, to: isoDate }),
  days: z.array(daySchema).max(7),
  totals: z.object({
    present: count,
    on_leave: count,
    absent: count,
    end_not_recorded: count,
    overtime: count,
    completed: count,
    cancelled: count,
    created: count,
    decisions: count,
    missing: count,
  }),
  now: z.object({
    waiting: z.object({
      tasks: count,
      leave: count,
      expense_claims: count,
      attendance: count,
      extra_work: count,
    }),
    overdue: count,
    unreachable: z.object({ count, names, more: count }),
  }),
  ahead: z.object({
    from: isoDate,
    to: isoDate,
    leave: z
      .array(
        z.object({
          member_id: z.uuid(),
          name: z.string().max(200),
          type: z.enum(["leave", "half_day", "comp_leave"]),
          from: isoDate,
          to: isoDate,
          pending: z.boolean(),
        }),
      )
      .max(500),
    events: z
      .array(
        z.object({
          id: z.uuid(),
          title: z.string().max(500),
          date: isoDate,
          start_at: z.string().nullable(),
          location: z.string().max(500).nullable(),
        }),
      )
      .max(500),
    holidays: z.array(z.object({ date: isoDate, name: z.string().max(200) })).max(50),
  }),
  // Kickoff 7 amendment C E4 (7.4): client work per Admin, counts only; absent before 7.4.
  client_work: z
    .array(
      z.object({
        admin_id: z.uuid().nullable(),
        name: z.string().max(200).nullable(),
        done: count,
        overdue: count,
        projects_completed: count,
      }),
    )
    .max(200)
    .default([]),
});

export type WeeklyDigestPayload = z.infer<typeof weeklyDigestSchema>;

/** The payload, checked; null when it is not one (the dispatcher records a failure, never throws). */
export function parseWeeklyDigestPayload(value: unknown): WeeklyDigestPayload | null {
  const parsed = weeklyDigestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const NOTHING_THIS_WEEK = "Nothing needs you this week.";

const day = (date: string, pattern = "EEE d MMM") => formatIST(istDayStart(date), pattern);

/** "Your week · 29 Sep – 5 Oct". */
export function weeklyDigestSubject(week: { from: string; to: string }): string {
  const sameMonth = week.from.slice(0, 7) === week.to.slice(0, 7);
  const from = sameMonth ? day(week.from, "d") : day(week.from, "d MMM");
  return `Your week · ${from} – ${day(week.to, "d MMM")}`;
}

export type DigestLine = { text: string; link: string | null };
export type DigestSection = { heading: string; lines: DigestLine[] };

const LEAVE_WORDS = { leave: "leave", half_day: "a half day", comp_leave: "comp leave" } as const;

function span(from: string, to: string): string {
  return from === to ? day(from) : `${day(from)} – ${day(to)}`;
}

/**
 * The digest's sections and lines, in order: the week (one line per day with its counts,
 * opening its saved report; then the totals), now (each opening its screen), the week ahead
 * (opening the calendar on that day).
 */
export function weeklyDigestSections(payload: WeeklyDigestPayload): DigestSection[] {
  const line = (label: string, value: number, link: string | null, text = `${value}`) =>
    value > 0 ? [{ text: `${label}: ${text}`, link }] : [];
  const dayLines: DigestLine[] = payload.days.flatMap((entry): DigestLine[] => {
    const parts: string[] = [];
    if (entry.holiday) parts.push(`holiday, ${entry.holiday}`);
    else if (entry.weekly_off) parts.push("weekly off");
    if (entry.present > 0) parts.push(`${entry.present} present`);
    if (entry.on_leave > 0) parts.push(`${entry.on_leave} on leave`);
    if (entry.absent > 0) parts.push(`${entry.absent} absent`);
    if (entry.end_not_recorded > 0) parts.push(`${entry.end_not_recorded} end not recorded`);
    if (entry.overtime > 0) parts.push(`${entry.overtime} overtime`);
    if (entry.completed > 0) parts.push(`${entry.completed} completed`);
    if (entry.created > 0) parts.push(`${entry.created} created`);
    if (entry.cancelled > 0) parts.push(`${entry.cancelled} cancelled`);
    if (entry.decisions > 0) parts.push(`${entry.decisions} decisions`);
    if (!entry.saved) return [{ text: `${day(entry.date)}: no report saved`, link: null }];
    if (parts.length === 0) return [];
    return [
      {
        text: `${day(entry.date)}: ${parts.join(", ")}`,
        link: `/reports/end-of-day/${entry.date}`,
      },
    ];
  });
  const totals = payload.totals;
  const totalLines: DigestLine[] = [
    ...line("Present, person-days", totals.present, null),
    ...line("On leave, person-days", totals.on_leave, null),
    ...line("Absent, person-days", totals.absent, null),
    ...line("End of day not recorded", totals.end_not_recorded, null),
    ...line("Overtime flagged", totals.overtime, null),
    ...line("Tasks completed", totals.completed, "/tasks/all?state=completed"),
    ...line("Tasks created", totals.created, null),
    ...line("Tasks cancelled", totals.cancelled, null),
    ...line("Decisions you made", totals.decisions, null),
  ];
  const sections: DigestSection[] = [
    { heading: `The week: ${span(payload.week.from, payload.week.to)}`, lines: dayLines },
    { heading: "The week's totals", lines: totalLines },
    {
      heading: "Now",
      lines: [
        ...line("Tasks waiting for your approval", payload.now.waiting.tasks, "/approvals"),
        ...line("Attendance waiting for a decision", payload.now.waiting.attendance, "/approvals"),
        ...line("Leave requests", payload.now.waiting.leave, "/approvals"),
        ...line("Extra work notes", payload.now.waiting.extra_work, "/approvals"),
        ...line("Expense claims", payload.now.waiting.expense_claims, "/approvals"),
        ...line("Overdue now", payload.now.overdue, "/tasks/all?overdue=overdue"),
        ...line(
          "Can't be reached",
          payload.now.unreachable.count,
          "/settings/notifications",
          payload.now.unreachable.names.length > 0
            ? `${payload.now.unreachable.count} (${payload.now.unreachable.names.join(", ")}${
                payload.now.unreachable.more > 0 ? ` +${payload.now.unreachable.more} more` : ""
              })`
            : `${payload.now.unreachable.count}`,
        ),
      ],
    },
    {
      // Kickoff 7 amendment C E4: per Admin, items done and projects completed that week (from
      // the saved reports) and items overdue now; counts only.
      heading: "Client work",
      lines: payload.client_work.flatMap((admin) => {
        const parts: string[] = [];
        if (admin.done > 0) parts.push(`${admin.done} ${admin.done === 1 ? "item" : "items"} done`);
        if (admin.overdue > 0) parts.push(`${admin.overdue} overdue now`);
        if (admin.projects_completed > 0) {
          parts.push(
            `${admin.projects_completed} ${admin.projects_completed === 1 ? "project" : "projects"} completed`,
          );
        }
        if (parts.length === 0) return [];
        const who = admin.admin_id === null ? "No Admin (yours)" : (admin.name ?? "An Admin");
        return [
          {
            text: `${who}: ${parts.join(", ")}`,
            link: admin.overdue > 0 ? "/clients/items?filter=overdue" : null,
          },
        ];
      }),
    },
    {
      heading: `The week ahead: ${span(payload.ahead.from, payload.ahead.to)}`,
      lines: [
        ...payload.ahead.holidays.map((holiday) => ({
          text: `Holiday ${day(holiday.date)}: ${holiday.name}`,
          link: `/calendar?view=day&date=${holiday.date}`,
        })),
        ...payload.ahead.leave.map((leave) => ({
          text: `${leave.name} ${leave.pending ? "has asked for" : "is on"} ${LEAVE_WORDS[leave.type]} ${span(leave.from, leave.to)}`,
          link: `/calendar?view=day&date=${leave.from}`,
        })),
        ...payload.ahead.events.map((event) => ({
          text: `${day(event.date)}${event.start_at ? `, ${formatIST(event.start_at, "h:mm aaa")}` : ""}: ${event.title}${event.location ? ` · ${event.location}` : ""}`,
          link: `/tasks/${event.id}`,
        })),
      ],
    },
  ];
  return sections.filter((section) => section.lines.length > 0);
}

const FOOTER =
  "MaxOff emails this summary to the Owner once a week, built from the saved end-of-day reports. It holds counts only, never an amount.";

export function renderWeeklyDigestEmail(
  payload: WeeklyDigestPayload,
  origin: string,
): NotificationEmail {
  const title = weeklyDigestSubject(payload.week);
  const subject = headerSafe(title);
  const sections = weeklyDigestSections(payload);

  const text = [
    title,
    ...(sections.length === 0
      ? ["", NOTHING_THIS_WEEK]
      : sections.flatMap((section) => [
          "",
          section.heading,
          ...section.lines.map((item) =>
            item.link ? `${item.text}: ${openUrl(origin, item.link)}` : item.text,
          ),
        ])),
    "",
    FOOTER,
  ].join("\n");

  const lineHtml = (item: DigestLine) =>
    item.link
      ? `<p style="margin:0 0 8px;font-size:15px;line-height:22px"><a href="${escapeHtml(openUrl(origin, item.link))}" style="color:${BRAND_RED};text-decoration:underline">${escapeHtml(item.text)}</a></p>`
      : `<p style="margin:0 0 8px;font-size:15px;line-height:22px;color:#3f3f46">${escapeHtml(item.text)}</p>`;
  const body =
    sections.length === 0
      ? [
          `<tr><td style="padding:16px 0 0;border-top:1px solid #e4e4e7"><p style="margin:0;font-size:15px;line-height:22px;color:#3f3f46">${escapeHtml(NOTHING_THIS_WEEK)}</p></td></tr>`,
        ]
      : sections.map((section) =>
          [
            '<tr><td style="padding:16px 0 8px;border-top:1px solid #e4e4e7">',
            `<h2 style="margin:0 0 8px;font-size:16px;line-height:24px;color:#18181b">${escapeHtml(section.heading)}</h2>`,
            ...section.lines.map(lineHtml),
            "</td></tr>",
          ].join(""),
        );
  const html = emailDocument(subject, 12, [
    `<tr><td style="padding-bottom:16px"><h1 style="margin:0;font-size:18px;line-height:26px;color:#18181b">${escapeHtml(title)}</h1></td></tr>`,
    ...body,
    `<tr><td style="padding-top:16px;font-size:12px;line-height:18px;color:#71717a">${escapeHtml(FOOTER)}</td></tr>`,
  ]);
  return { subject, text, html };
}
