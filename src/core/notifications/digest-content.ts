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
 * The Owner's morning summary (5B slice 7, owner decisions 2026-10-03; WORKFLOWS "Owner digest"):
 * the email `digest_daily` queues at 08:00 IST, rendered from the row's payload
 * (`app.owner_digest_payload`). Counts only, never an amount (an email can be forwarded or read on
 * a shared screen). Each line opens its screen through `/open?to=`; a line at 0 is left out, a
 * section with no line too, and when everything is 0 the email says "Nothing needs you today."
 * Pure: the dispatcher hands in the origin; `/diagnostics/digest` renders the same.
 */
export const DIGEST_KIND = "owner_digest";

const count = z.number().int().min(0);
const names = z.array(z.string().max(200)).max(5);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const digestPayloadSchema = z.object({
  date: isoDate,
  yesterday: isoDate,
  attendance: z.object({
    present: count,
    on_leave: count,
    absent: count,
    absent_names: names,
    absent_more: count,
    day_not_ended: count,
    day_not_ended_names: names,
    day_not_ended_more: count,
  }),
  tasks: z.object({ approved_yesterday: count, overdue: count, waiting_for_owner: count }),
  requests: z.object({ leave: count, expense_claims: count }),
  held_back: z
    .array(
      z.object({
        kind: z.string().max(100),
        description: z.string().max(500).nullable(),
        count,
      }),
    )
    .max(100),
});

export type DigestPayload = z.infer<typeof digestPayloadSchema>;

/** The payload, checked; null when it is not one (the dispatcher records a failure, never throws). */
export function parseDigestPayload(value: unknown): DigestPayload | null {
  const parsed = digestPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const NOTHING_NEEDS_YOU = "Nothing needs you today.";

/** "Your morning summary · Sat 3 Oct": the digest's IST day. */
export function digestSubject(date: string): string {
  return `Your morning summary · ${formatIST(istDayStart(date), "EEE d MMM")}`;
}

/**
 * What a held-back email was, in words: the kinds the daily limit can drop (always emailed, or a
 * fallback for someone with no working push). Any other kind reads as its description, else
 * "Other emails"; never a raw identifier.
 */
const HELD_BACK_LABELS: Readonly<Record<string, string>> = {
  reminder_before_due_last: "Last reminders before a deadline",
  reminder_overdue: "Overdue reminders",
  reminder_event: "Event reminders for the next day",
  escalation_not_noted: "Not-noted escalations",
  escalation_overdue: "Overdue escalations",
  task_assigned: "Task assigned",
  task_changes_requested: "Changes requested",
  attendance_decided: "Attendance decisions",
  leave_decided: "Leave decisions",
  extra_work_decided: "Extra work decisions",
  comp_leave_granted: "Comp leave granted",
  comp_leave_revoked: "Comp leave taken back",
  expense_decided: "Expense claim decisions",
  owner_digest: "Morning summaries",
};

export function heldBackLabel(kind: string, description: string | null): string {
  return HELD_BACK_LABELS[kind] ?? (description?.trim() || "Other emails");
}

export type DigestLine = { text: string; link: string | null };
export type DigestSection = { heading: string; lines: DigestLine[] };

function named(total: number, first: readonly string[], more: number): string {
  if (first.length === 0) return `${total}`;
  return `${total} (${first.join(", ")}${more > 0 ? ` +${more} more` : ""})`;
}

/**
 * The digest's sections and lines, in order. The screens each line opens (all the Owner's):
 * attendance → the team's month for yesterday's month (`/reports/month`: everyone's days worked,
 * leave and absences; a person's row opens their days); approved yesterday → all tasks, Completed;
 * overdue → all tasks, Overdue; waiting for approval, leave and expense claims → Approvals. The
 * held-back emails show on no screen, so their lines open nothing.
 */
export function digestSections(payload: DigestPayload): DigestSection[] {
  const { attendance, tasks, requests } = payload;
  const month = `/reports/month?month=${payload.yesterday.slice(0, 7)}`;
  const line = (label: string, value: number, link: string | null, text = `${value}`) =>
    value > 0 ? [{ text: `${label}: ${text}`, link }] : [];
  const sections: DigestSection[] = [
    {
      heading: "Attendance yesterday",
      lines: [
        ...line("Present", attendance.present, month),
        ...line("On leave", attendance.on_leave, month),
        ...line(
          "Absent",
          attendance.absent,
          month,
          named(attendance.absent, attendance.absent_names, attendance.absent_more),
        ),
        ...line(
          "Day not ended",
          attendance.day_not_ended,
          month,
          named(
            attendance.day_not_ended,
            attendance.day_not_ended_names,
            attendance.day_not_ended_more,
          ),
        ),
      ],
    },
    {
      heading: "Tasks",
      lines: [
        ...line("Approved yesterday", tasks.approved_yesterday, "/tasks/all?state=completed"),
        ...line("Overdue now", tasks.overdue, "/tasks/all?overdue=overdue"),
        ...line("Waiting for your approval", tasks.waiting_for_owner, "/approvals"),
      ],
    },
    {
      heading: "Requests waiting for you",
      lines: [
        ...line("Leave requests", requests.leave, "/approvals"),
        ...line("Expense claims", requests.expense_claims, "/approvals"),
      ],
    },
    {
      heading: "Emails held back yesterday by the daily limit",
      lines: payload.held_back.flatMap((held) =>
        line(heldBackLabel(held.kind, held.description), held.count, null),
      ),
    },
  ];
  return sections.filter((section) => section.lines.length > 0);
}

const FOOTER =
  "MaxOff emails this summary to the Owner every morning at 08:00 IST. It holds counts only, never an amount.";

export function renderDigestEmail(payload: DigestPayload, origin: string): NotificationEmail {
  const title = digestSubject(payload.date);
  const subject = headerSafe(title);
  const sections = digestSections(payload);

  const text = [
    title,
    ...(sections.length === 0
      ? ["", NOTHING_NEEDS_YOU]
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
          `<tr><td style="padding:16px 0 0;border-top:1px solid #e4e4e7"><p style="margin:0;font-size:15px;line-height:22px;color:#3f3f46">${escapeHtml(NOTHING_NEEDS_YOU)}</p></td></tr>`,
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

/**
 * The sample on the preview (`/diagnostics/digest`, owner decision 2026-10-03): the email exactly
 * as it is sent, with its subject and text part shown plainly above it.
 */
export function digestSamplePage(email: NotificationEmail): string {
  const preface = [
    '<div style="max-width:520px;margin:0 auto;padding:16px 12px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:19px;color:#18181b">',
    '<p style="margin:0 0 8px;font-weight:700">Sample only: nothing was sent or saved.</p>',
    `<p style="margin:0 0 8px">Subject: ${escapeHtml(email.subject)}</p>`,
    `<pre style="margin:0;white-space:pre-wrap;word-break:break-word">${escapeHtml(email.text)}</pre>`,
    "</div>",
  ].join("");
  return email.html.replace(/(<body[^>]*>)/, `$1${preface}`);
}
