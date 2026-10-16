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

import { RESEND_API_KEY, type EnvSource } from "./email-env";

export { EMAIL_FROM, RESEND_API_KEY, emailStartupWarning, readEmailEnv } from "./email-env";
export type { EmailEnv } from "./email-env";

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

/**
 * `PUSH_ALLOW_LOOPBACK_ENDPOINTS=1` lets the push sender POST to plain http on the loopback host,
 * where the e2e fake push service runs (playwright.config.ts sets it for the e2e server only).
 * Never honoured in staging or production, whatever the variable says: there every endpoint must
 * be https on a public DNS name (5A review M2, defence in depth behind the database's check).
 */
export const PUSH_ALLOW_LOOPBACK_ENDPOINTS = "PUSH_ALLOW_LOOPBACK_ENDPOINTS";

export function pushLoopbackAllowed(env: EnvSource = process.env): boolean {
  // Read literally from process.env so the build inlines it, as everywhere else.
  const appEnv = env === process.env ? process.env.NEXT_PUBLIC_APP_ENV : env.NEXT_PUBLIC_APP_ENV;
  if (appEnv === "staging" || appEnv === "production") return false;
  return env[PUSH_ALLOW_LOOPBACK_ENDPOINTS] === "1";
}

/** The bearer the Worker's crons present (`core/http/cron-auth.ts`); named here for the check below. */
export const CRON_SECRET = "CRON_SECRET";

/** The server settings notifications need, in the order Settings → Notifications names them. */
export const NOTIFICATION_SETTINGS = [
  RESEND_API_KEY,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT,
  CRON_SECRET,
] as const;

export type OperationalWarning = {
  /** Settings that are not set at all. */
  missing: string[];
  /** The `VAPID_*` settings when all three are set but push is still off (malformed). */
  invalid: string[];
};

/**
 * The Owner's operational warning on Settings → Notifications (5.4, kickoff 5 decision 14): which
 * of the settings push and email need are missing, by **name only**, read at runtime on the
 * server. Never a value, and never a hint of one (the VAPID rule that failed is not repeated).
 * Null when everything is in place.
 */
export function operationalWarning(env: EnvSource = process.env): OperationalWarning | null {
  const missing: string[] = NOTIFICATION_SETTINGS.filter((name) => !env[name]?.trim());
  const vapid = [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT];
  const invalid =
    vapid.every((name) => !missing.includes(name)) && readPushEnv(env).mode === "off" ? vapid : [];
  return missing.length === 0 && invalid.length === 0 ? null : { missing, invalid };
}
