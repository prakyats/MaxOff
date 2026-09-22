/**
 * Email delivery configuration (task 1.2; the first sender arrives with 1.3 invites, the
 * notification channel with 5.2).
 *
 * - `RESEND_API_KEY` set → mail goes out through Resend.
 * - unset → the log sender: nothing is sent, nothing crashes, and the app says so once at
 *   start-up (`emailStartupWarning`). Until a sending domain is verified (mail.maxoff.app,
 *   PROGRESS.md) this is the state of every environment, and Supabase Auth's own mail
 *   (recovery links) is unaffected: it never goes through the app.
 */

export const RESEND_API_KEY = "RESEND_API_KEY";
export const EMAIL_FROM = "EMAIL_FROM";
const DEFAULT_FROM = "MaxOff <noreply@localhost>";

export type EmailEnv =
  { mode: "resend"; apiKey: string; from: string } | { mode: "log"; from: string };

type EnvSource = Readonly<Record<string, string | undefined>>;

export function readEmailEnv(env: EnvSource = process.env): EmailEnv {
  const apiKey = env[RESEND_API_KEY]?.trim();
  const from = env[EMAIL_FROM]?.trim() || DEFAULT_FROM;
  return apiKey ? { mode: "resend", apiKey, from } : { mode: "log", from };
}

/**
 * The start-up line for a missing key, or null when mail is configured. Never an exception:
 * a missing mail key must not take the app down. `production` is louder (the caller logs it
 * at error level) but still only a log line (decided 2026-09-22).
 */
export function emailStartupWarning(env: EnvSource = process.env): string | null {
  if (readEmailEnv(env).mode === "resend") return null;
  return `[email] ${RESEND_API_KEY} is not set: no email will be sent. Invites (1.3) and notification email (5.2) need it, and a verified sending domain (see PROGRESS.md).`;
}
