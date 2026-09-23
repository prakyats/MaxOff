/** How long an invite link works (GoTrue `otp_expiry`, 24 h, decided 2026-09-22). */
export const INVITE_LINK_HOURS = 24;

/**
 * The link an invite email carries and "Copy invite link" shows: the token-hash route of
 * ADR-0012, verified server-side, so it works on any device. `origin` is the app's own
 * (NEXT_PUBLIC_APP_URL, or the request's origin locally); `tokenHash` comes from
 * `auth.admin.generateLink()` and is never stored. `type` is `invite` for a fresh sign-in and
 * `recovery` once GoTrue has confirmed the user (a link was opened but no password set); the
 * app treats both the same for an invited member.
 */
export function inviteLinkFor(
  origin: string,
  tokenHash: string,
  type: "invite" | "recovery" = "invite",
): string {
  const url = new URL("/auth/confirm", origin);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", type);
  return url.toString();
}

export type InviteEmailInput = {
  to: string;
  inviteeName: string;
  inviterName: string;
  link: string;
};

/** The invite email (WORKFLOWS §9: email, bypasses the daily cap). Plain and short. */
export function inviteEmail({ to, inviteeName, inviterName, link }: InviteEmailInput) {
  const subject = `${inviterName} invited you to MaxOff`;
  const text = [
    `Hi ${inviteeName},`,
    "",
    `${inviterName} has invited you to MaxOff, the Pixora Clips team app.`,
    `Open this link to choose your password (it works once and expires in ${INVITE_LINK_HOURS} hours):`,
    "",
    link,
    "",
    "If you weren't expecting this, you can ignore it; nothing happens until the link is used.",
  ].join("\n");
  const html = [
    `<p>Hi ${escapeHtml(inviteeName)},</p>`,
    `<p>${escapeHtml(inviterName)} has invited you to MaxOff, the Pixora Clips team app.</p>`,
    `<p>Open this link to choose your password (it works once and expires in ${INVITE_LINK_HOURS} hours):</p>`,
    `<p><a href="${escapeHtml(link)}">Set my password</a></p>`,
    `<p>If you weren't expecting this, you can ignore it; nothing happens until the link is used.</p>`,
  ].join("\n");
  return { to, subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
