import "server-only";

import { after } from "next/server";

import { resolveAppOrigin } from "@/core/lib/app-url";
import { captureException } from "@/core/observability/capture";

import { createEmailSender } from "../email";
import { type EmailDispatchReport, runEmailDispatch } from "../email-dispatcher";
import { supabaseEmailStore } from "../email-store";
import { pushEnvOrWarn, pushLoopbackAllowed, readEmailEnv } from "../env";
import { type DispatchReport, runPushDispatch } from "./dispatcher";
import { supabasePushStore } from "./store";

/**
 * The server entry of the dispatcher: the environment's VAPID keys and Resend key, the
 * service-role stores and the platform's `fetch`. `dispatchPush()` and then `dispatchEmail()`
 * are what the cron route runs every minute; `dispatchPushSoon()` is the cheap call a
 * transition's action makes so a push (and an email) does not wait for the cron: it runs after
 * the response through `after()` (a Worker's `waitUntil`), sends a small batch and never throws
 * into the action. Push off (no VAPID keys): nothing is claimed; the rows wait for the keys.
 * Email off (no RESEND_API_KEY): the email rows are recorded failed `not_configured`.
 */
export const AFTER_ACTION_LIMIT = 10;

export async function dispatchPush(limit?: number): Promise<DispatchReport | { skipped: string }> {
  const push = pushEnvOrWarn();
  if (push.mode === "off") return { skipped: push.reason };
  return runPushDispatch({
    store: supabasePushStore(),
    vapid: { publicKey: push.publicKey, privateKey: push.privateKey, subject: push.subject },
    fetch: (url, init) => fetch(url, init),
    allowLoopback: pushLoopbackAllowed(),
    onItemError: (error) => {
      captureException(error);
    },
    ...(limit === undefined ? {} : { limit }),
  });
}

/** Runs after the push pass, so an actionable row whose push just went out is not mailed. */
export async function dispatchEmail(limit?: number): Promise<EmailDispatchReport> {
  const env = readEmailEnv();
  return runEmailDispatch({
    store: supabaseEmailStore(),
    sender: env.mode === "resend" ? createEmailSender(env) : null,
    // Staging and production fail loud without NEXT_PUBLIC_APP_URL (no Host header here).
    origin: resolveAppOrigin(
      process.env.NEXT_PUBLIC_APP_URL,
      null,
      null,
      process.env.NEXT_PUBLIC_APP_ENV,
    ),
    onItemError: (error) => {
      captureException(error);
    },
    ...(limit === undefined ? {} : { limit }),
  });
}

export function dispatchPushSoon(): void {
  after(async () => {
    try {
      await dispatchPush(AFTER_ACTION_LIMIT);
    } catch (error) {
      captureException(error);
    }
    try {
      await dispatchEmail(AFTER_ACTION_LIMIT);
    } catch (error) {
      captureException(error);
    }
  });
}
