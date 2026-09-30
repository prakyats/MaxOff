import "server-only";

import { after } from "next/server";

import { captureException } from "@/core/observability/capture";

import { pushEnvOrWarn } from "../env";
import { type DispatchReport, runPushDispatch } from "./dispatcher";
import { supabasePushStore } from "./store";

/**
 * The server entry of the dispatcher: the environment's VAPID keys, the service-role store
 * and the platform's `fetch`. `dispatchPush()` is what the cron route runs every minute;
 * `dispatchPushSoon()` is the cheap call a transition's action makes so a push does not wait
 * for the cron: it runs after the response through `after()` (a Worker's `waitUntil`), sends a
 * small batch and never throws into the action. Push off (no keys): nothing is claimed; the
 * rows wait for the keys, the cron keeps looking.
 */
export const AFTER_ACTION_LIMIT = 10;

export async function dispatchPush(limit?: number): Promise<DispatchReport | { skipped: string }> {
  const push = pushEnvOrWarn();
  if (push.mode === "off") return { skipped: push.reason };
  return runPushDispatch({
    store: supabasePushStore(),
    vapid: { publicKey: push.publicKey, privateKey: push.privateKey, subject: push.subject },
    fetch: (url, init) => fetch(url, init),
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
  });
}
