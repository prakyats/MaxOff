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

/**
 * Web Push configuration (task 5.2, ADR-0009, kickoff 5 decisions 10 and 26). The three
 * `VAPID_*` values are read at runtime (Worker secrets through `deploy.yml`; `.env.local`
 * locally) and checked with zod: the public key an uncompressed P-256 point (65 bytes, 87
 * base64url characters), the private key a 32-byte scalar (43 characters), the subject a
 * `mailto:` or `https:` URL. Anything missing or malformed means **push is off**: the
 * in-app rows still exist, the dispatcher records nothing as sent, the app logs one warning
 * and never crashes. Keys are never generated, printed or logged here (decision 10).
 */
import { z } from "zod";

export const VAPID_PUBLIC_KEY = "VAPID_PUBLIC_KEY";
export const VAPID_PRIVATE_KEY = "VAPID_PRIVATE_KEY";
export const VAPID_SUBJECT = "VAPID_SUBJECT";

const base64url = (length: number, what: string) =>
  z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]+$/, `${what} must be base64url`)
    .length(length, `${what} must be ${length} characters`);

const pushEnvSchema = z.object({
  [VAPID_PUBLIC_KEY]: base64url(87, VAPID_PUBLIC_KEY).refine(
    (value) => value.startsWith("B"),
    `${VAPID_PUBLIC_KEY} must be an uncompressed P-256 point`,
  ),
  [VAPID_PRIVATE_KEY]: base64url(43, VAPID_PRIVATE_KEY),
  [VAPID_SUBJECT]: z
    .string()
    .trim()
    .regex(
      /^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/,
      `${VAPID_SUBJECT} must be mailto: or https:`,
    ),
});

export type PushEnv =
  | { mode: "on"; publicKey: string; privateKey: string; subject: string }
  | { mode: "off"; reason: string };

export function readPushEnv(env: EnvSource = process.env): PushEnv {
  const raw = {
    [VAPID_PUBLIC_KEY]: env[VAPID_PUBLIC_KEY],
    [VAPID_PRIVATE_KEY]: env[VAPID_PRIVATE_KEY],
    [VAPID_SUBJECT]: env[VAPID_SUBJECT],
  };
  const missing = Object.entries(raw)
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);
  if (missing.length > 0) return { mode: "off", reason: `${missing.join(", ")} not set` };
  const parsed = pushEnvSchema.safeParse(raw);
  if (!parsed.success) {
    // The issue names the variable and the rule, never the value.
    return { mode: "off", reason: parsed.error.issues.map((issue) => issue.message).join("; ") };
  }
  return {
    mode: "on",
    publicKey: parsed.data[VAPID_PUBLIC_KEY],
    privateKey: parsed.data[VAPID_PRIVATE_KEY],
    subject: parsed.data[VAPID_SUBJECT],
  };
}

/** The one warning line when push is off, or null. Logged once per process by the callers. */
export function pushStartupWarning(env: EnvSource = process.env): string | null {
  const push = readPushEnv(env);
  if (push.mode === "on") return null;
  return `[push] Web Push is off: ${push.reason}. In-app notifications still work; set ${VAPID_PUBLIC_KEY}, ${VAPID_PRIVATE_KEY} and ${VAPID_SUBJECT} (README "Hosted settings") to send push.`;
}

let warnedPushOff = false;
/** `readPushEnv()`, logging the warning the first time push is found off. */
export function pushEnvOrWarn(env: EnvSource = process.env): PushEnv {
  const push = readPushEnv(env);
  if (push.mode === "off" && !warnedPushOff) {
    warnedPushOff = true;
    console.warn(pushStartupWarning(env));
  }
  return push;
}
