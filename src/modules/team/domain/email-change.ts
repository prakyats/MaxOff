/**
 * The two emails an email change sends (WORKFLOWS §1a). Both, always: the new address needs
 * to know it is the login from now on, and the old one — the message that matters when the
 * mailbox is still live — needs to know the login moved. They bypass the daily cap (§9).
 */

export type EmailChangeNotice = {
  memberName: string;
  oldEmail: string;
  newEmail: string;
  /** Who made the change, so the reader knows whom to ask. */
  changedBy: string;
  /**
   * An invited person has no password yet, and moving the address kills their pending link
   * (WORKFLOWS 1a), so "use your existing password" would send them nowhere.
   */
  accepted: boolean;
};

export function emailChangedNewAddressEmail({
  memberName,
  newEmail,
  changedBy,
  accepted,
}: EmailChangeNotice) {
  const subject = accepted
    ? "Your MaxOff sign-in address has changed"
    : "Your MaxOff invitation moved to this address";
  const lines = accepted
    ? [
        `Hi ${memberName},`,
        "",
        `${changedBy} changed your MaxOff sign-in to this address.`,
        `From now on, sign in with ${newEmail} and your existing password.`,
        "",
        "If this wasn't expected, reply to this email or tell the Owner.",
      ]
    : [
        `Hi ${memberName},`,
        "",
        `${changedBy} moved your MaxOff invitation to this address.`,
        `${changedBy} will send you a fresh link to set your password; any earlier link has stopped working.`,
        "",
        "If you weren't expecting this, you can ignore it.",
      ];
  return { to: newEmail, subject, text: lines.join("\n"), html: paragraphs(lines) };
}

export function emailChangedOldAddressEmail({
  memberName,
  oldEmail,
  newEmail,
  changedBy,
}: EmailChangeNotice) {
  const subject = "Your MaxOff sign-in address was changed";
  const lines = [
    `Hi ${memberName},`,
    "",
    `${changedBy} moved your MaxOff sign-in from ${oldEmail} to ${newEmail}.`,
    "This address can no longer be used to sign in.",
    "",
    "If this wasn't expected, tell the Owner straight away.",
  ];
  return { to: oldEmail, subject, text: lines.join("\n"), html: paragraphs(lines) };
}

function paragraphs(lines: readonly string[]): string {
  return lines
    .filter((line) => line !== "")
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
