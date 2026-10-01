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
const BRAND_RED = "#c42126";
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
  const html = [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(subject)}</title></head>`,
    "<body style=\"margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif\">",
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px"><tr><td align="center">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:24px">',
    `<tr><td style="padding-bottom:16px;font-size:13px;font-weight:700;letter-spacing:0.04em;color:${BRAND_RED}">MAXOFF</td></tr>`,
    '<tr><td style="padding-bottom:12px">',
    `<h1 style="margin:0;font-size:18px;line-height:26px;color:#18181b">${escapeHtml(input.title.trim())}</h1>`,
    "</td></tr>",
    `<tr><td>${paragraphs}</td></tr>`,
    '<tr><td style="padding-top:8px">',
    `<a href="${escapeHtml(url)}" style="display:inline-block;background:${BRAND_RED};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 20px;border-radius:8px">Open in MaxOff</a>`,
    "</td></tr>",
    '<tr><td style="padding-top:24px;font-size:12px;line-height:18px;color:#71717a">You get this email because you have no working MaxOff notifications on a device, or because it is one MaxOff always emails.</td></tr>',
    "</table></td></tr></table></body></html>",
  ].join("");

  return { subject, text, html };
}
