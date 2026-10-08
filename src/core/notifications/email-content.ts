/**
 * What a notification email says (task 5.2; kickoff 5 decisions 6, 7 and 10): the row's own
 * title and body, and one button to its deep link through the entry `/open` on the app's origin,
 * so the record opens with its list underneath (ARCHITECTURE §14.2 h), as a push tap does. Plain
 * and branded, an HTML part and a text part. Pure: the dispatcher hands in the origin.
 *
 * Every string in it may be user-entered (a task title, a comment, a person's name): the HTML
 * part escapes all of it, and the subject is made header-safe (`headerSafe`: no CR, LF or other
 * control character can start a header). The rows never carry an amount (invariant 2, decision
 * 24) or a record the person lost access to (decision 25), so neither can an email.
 */
export const BRAND_RED = "#c42126";
const NOTIFICATIONS_PATH = "/notifications";
const SUBJECT_MAX = 150;

export type NotificationEmailInput = {
  title: string;
  body: string | null;
  link: string | null;
  /** The app's origin (`NEXT_PUBLIC_APP_URL`), e.g. `https://app.maxoff.in`. */
  origin: string;
};

export type NotificationEmail = { subject: string; text: string; html: string };

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * One line, safe in a mail header: every control character (CR and LF included) and every
 * line or paragraph separator becomes a space, runs of spaces collapse, and it is cut to a
 * readable length. Never empty.
 */
export function headerSafe(value: string, max = SUBJECT_MAX): string {
  const line = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ");
  const collapsed = line.replace(/\s+/g, " ").trim();
  const cut = collapsed.length > max ? `${collapsed.slice(0, max - 1).trimEnd()}…` : collapsed;
  return cut || "MaxOff";
}

/**
 * The branded page every notification email shares: the grey background, the white card and the
 * MAXOFF mark (`brandGap` px under it), then the card's own rows (`<tr>…</tr>`, already escaped).
 */
export function emailDocument(subject: string, brandGap: number, rows: readonly string[]): string {
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(subject)}</title></head>`,
    "<body style=\"margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif\">",
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px"><tr><td align="center">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:24px">',
    `<tr><td style="padding-bottom:${brandGap}px;font-size:13px;font-weight:700;letter-spacing:0.04em;color:${BRAND_RED}">MAXOFF</td></tr>`,
    ...rows,
    "</table></td></tr></table></body></html>",
  ].join("");
}

/** The deep-link entry for a row's link; a missing or outside link opens the history. */
export function openUrl(origin: string, link: string | null): string {
  const safe = link && link.startsWith("/") && !link.startsWith("//") ? link : NOTIFICATIONS_PATH;
  return `${origin}/open?to=${encodeURIComponent(safe)}`;
}

export function renderNotificationEmail(input: NotificationEmailInput): NotificationEmail {
  const subject = headerSafe(input.title);
  const url = openUrl(input.origin, input.link);
  const body = input.body?.trim() ? input.body.trim() : null;

  const text = [
    input.title.trim(),
    ...(body ? ["", body] : []),
    "",
    `Open in MaxOff: ${url}`,
    "",
    "You get this email because you have no working MaxOff notifications on a device, or because it is one MaxOff always emails.",
  ].join("\n");

  const paragraphs = body
    ? body
        .split(/\n{2,}/)
        .map(
          (part) =>
            `<p style="margin:0 0 12px;font-size:15px;line-height:22px;color:#3f3f46">${escapeHtml(part).replaceAll("\n", "<br>")}</p>`,
        )
        .join("")
    : "";
  const html = emailDocument(subject, 16, [
    '<tr><td style="padding-bottom:12px">',
    `<h1 style="margin:0;font-size:18px;line-height:26px;color:#18181b">${escapeHtml(input.title.trim())}</h1>`,
    "</td></tr>",
    `<tr><td>${paragraphs}</td></tr>`,
    '<tr><td style="padding-top:8px">',
    `<a href="${escapeHtml(url)}" style="display:inline-block;background:${BRAND_RED};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 20px;border-radius:8px">Open in MaxOff</a>`,
    "</td></tr>",
    '<tr><td style="padding-top:24px;font-size:12px;line-height:18px;color:#71717a">You get this email because you have no working MaxOff notifications on a device, or because it is one MaxOff always emails.</td></tr>',
  ]);

  return { subject, text, html };
}

/** One item of a combined email (5.3): a notification as the person already sees it. */
export type CombinedEmailItem = {
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  escalationLevel: number;
};

/**
 * How urgent an item is, for the subject (owner 2026-10-02): an escalation first, then overdue,
 * then before-due (Due now included), then anything else always emailed (an event tomorrow).
 */
export function urgencyOf(item: Pick<CombinedEmailItem, "kind" | "escalationLevel">): number {
  if (item.escalationLevel > 0 || item.kind.startsWith("escalation_")) return 0;
  if (
    item.kind === "reminder_overdue" ||
    item.kind === "reminder_item_overdue" ||
    item.kind === "reminder_delivery_missed"
  )
    return 1;
  if (item.kind.startsWith("reminder_before_due") || item.kind === "reminder_due_now") return 2;
  return 3;
}

/** The items most urgent first (a stable sort: same urgency keeps the claim's oldest-first order). */
export function byUrgency<T extends Pick<CombinedEmailItem, "kind" | "escalationLevel">>(
  items: readonly T[],
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => urgencyOf(a.item) - urgencyOf(b.item) || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * One email for a person's always-emailed rows of one dispatch run (5.3, owner 2026-10-02). The
 * subject names the most urgent ("Not noted yet: Reel 9 · +2 more"); the body lists every item,
 * each with its own text and button. Nothing beyond what each row already shows that person
 * (the rows never hold an amount or a record they lost access to), all of it escaped.
 */
export function renderCombinedEmail(input: {
  items: readonly CombinedEmailItem[];
  origin: string;
}): NotificationEmail {
  const [first, ...rest] = byUrgency(input.items);
  if (!first) throw new Error("A combined email needs at least one item.");
  if (rest.length === 0) {
    return renderNotificationEmail({ ...first, origin: input.origin });
  }
  const subject = headerSafe(`${first.title} · +${rest.length} more`);
  const all = [first, ...rest];
  const footer =
    "You get this email because these are messages MaxOff always emails. Each one is also in the app's Alerts.";
  const text = [
    `${all.length} updates from MaxOff`,
    ...all.flatMap((item) => [
      "",
      item.title.trim(),
      ...(item.body?.trim() ? [item.body.trim()] : []),
      `Open in MaxOff: ${openUrl(input.origin, item.link)}`,
    ]),
    "",
    footer,
  ].join("\n");
  const sections = all
    .map((item) => {
      const body = item.body?.trim()
        ? `<p style="margin:0 0 8px;font-size:15px;line-height:22px;color:#3f3f46">${escapeHtml(item.body.trim()).replaceAll("\n", "<br>")}</p>`
        : "";
      return [
        '<tr><td style="padding:16px 0;border-top:1px solid #e4e4e7">',
        `<h2 style="margin:0 0 8px;font-size:16px;line-height:24px;color:#18181b">${escapeHtml(item.title.trim())}</h2>`,
        body,
        `<a href="${escapeHtml(openUrl(input.origin, item.link))}" style="display:inline-block;color:${BRAND_RED};font-size:15px;font-weight:600;text-decoration:underline">Open in MaxOff</a>`,
        "</td></tr>",
      ].join("");
    })
    .join("");
  const html = emailDocument(subject, 12, [
    `<tr><td style="padding-bottom:4px"><h1 style="margin:0;font-size:18px;line-height:26px;color:#18181b">${all.length} updates</h1></td></tr>`,
    sections,
    `<tr><td style="padding-top:16px;font-size:12px;line-height:18px;color:#71717a">${escapeHtml(footer)}</td></tr>`,
  ]);
  return { subject, text, html };
}
