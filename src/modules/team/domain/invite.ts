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
  /** The sign-in rule the "Good to know" box states (`PASSWORD_MIN_LENGTH`, `core/auth`). */
  passwordMinLength: number;
};

const FONT = `"Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
const BRAND_RED = "#C42126";

/**
 * The invite email (WORKFLOWS §9: email, bypasses the daily cap), in the branded design of the
 * password email (`supabase/templates/recovery.html`, owner 2026-10-01): the logo and "MaxOff",
 * a red "Set my password" button, the "Good to know" box (the link works once and expires in
 * 24 hours, 12+ characters, open the installed app), a fallback link, "Didn't ask for this?";
 * and a plain-text part. Email clients ignore most CSS, so the HTML is tables with inline styles.
 * The logo is served by the app the link points at (its origin). Every name is user-entered and
 * escaped, the link too (it sits in an attribute); the subject is made one line by the sender.
 * No amount and nothing beyond the names and the link.
 */
export function inviteEmail({
  to,
  inviteeName,
  inviterName,
  link,
  passwordMinLength,
}: InviteEmailInput) {
  const subject = `${inviterName} invited you to MaxOff`;
  const text = [
    `Hi ${inviteeName},`,
    "",
    `${inviterName} has invited you to MaxOff, the Pixora Clips team app.`,
    "Open this link to choose your password:",
    "",
    link,
    "",
    "Good to know:",
    `- The link works once and expires in ${INVITE_LINK_HOURS} hours.`,
    `- Use at least ${passwordMinLength} characters. A short sentence is easy to remember.`,
    "- After saving, MaxOff opens straight away. On your phone, open it from the installed MaxOff app.",
    "",
    "Didn't ask for this? You can ignore this email; nothing happens until the link is used.",
    "MaxOff and Pixora Clips will never ask for your password by phone, WhatsApp or email.",
  ].join("\n");

  const origin = new URL(link).origin;
  const name = escapeHtml(inviteeName);
  const inviter = escapeHtml(inviterName);
  const href = escapeHtml(link);
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <title>You're invited to MaxOff</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #f4f4f5">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0">${inviter} invited you to MaxOff. Set your password: the link works once, within ${INVITE_LINK_HOURS} hours.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f5">
      <tr>
        <td align="center" style="padding: 32px 16px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 560px">
            <tr>
              <td style="padding: 0 4px 20px 4px">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="vertical-align: middle; padding-right: 12px">
                      <img src="${escapeHtml(origin)}/icons/icon-192.png" width="44" height="44" alt="MaxOff" style="display: block; border: 0; border-radius: 10px" />
                    </td>
                    <td style="vertical-align: middle; font-family: ${FONT}">
                      <div style="font-size: 20px; font-weight: 700; color: #16161a; line-height: 1.2">MaxOff</div>
                      <div style="font-size: 12px; color: #52525b; line-height: 1.4">Pixora Clips operations</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background-color: #ffffff; border: 1px solid #e4e4e7; border-radius: 14px; padding: 32px 28px; font-family: ${FONT}; color: #16161a">
                <h1 style="margin: 0 0 12px 0; font-size: 22px; line-height: 1.3; font-weight: 700">You're invited to MaxOff</h1>
                <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #3f3f46">Hi ${name}, <strong style="color: #16161a">${inviter}</strong> has invited you to MaxOff, the Pixora Clips team app. Use the button below to choose your password.</p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 24px 0">
                  <tr>
                    <td align="center" bgcolor="${BRAND_RED}" style="border-radius: 10px">
                      <a href="${href}" style="display: inline-block; padding: 14px 28px; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 10px">Set my password</a>
                    </td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8f8f9; border-radius: 10px; margin: 0 0 24px 0">
                  <tr>
                    <td style="padding: 16px 18px; font-size: 14px; line-height: 1.6; color: #3f3f46">
                      <div style="font-weight: 600; color: #16161a; margin-bottom: 6px">Good to know</div>
                      <div>• The link works <strong>once</strong> and expires in <strong>${INVITE_LINK_HOURS} hours</strong>.</div>
                      <div>• Use at least <strong>${passwordMinLength} characters</strong>. A short sentence is easy to remember.</div>
                      <div>• After saving, MaxOff opens straight away. On your phone, open it from the installed MaxOff app.</div>
                    </td>
                  </tr>
                </table>
                <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.6; color: #71717a">Button not working? Copy this link into your browser:</p>
                <p style="margin: 0 0 24px 0; font-size: 12px; line-height: 1.5; color: #52525b; word-break: break-all">${href}</p>
                <div style="border-top: 1px solid #e4e4e7; padding-top: 18px">
                  <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.6; color: #3f3f46"><strong style="color: #16161a">Didn't ask for this?</strong> You can ignore this email. Nothing happens unless the link is used.</p>
                  <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #3f3f46"><strong style="color: #16161a">Stay safe:</strong> MaxOff and Pixora Clips will never ask for your password by phone, WhatsApp or email. Don't forward this email.</p>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding: 20px 8px 0 8px; font-family: ${FONT}; font-size: 12px; line-height: 1.6; color: #52525b; text-align: center">MaxOff is Pixora Clips' internal work app. You're receiving this because ${inviter} added you to the team. This mailbox isn't monitored: for help, ask the MaxOff owner at Pixora Clips.</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return { to, subject, text, html };
}

/** Every user-entered string in the HTML part: text and attribute values alike. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
