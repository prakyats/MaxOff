import { systemClock } from "@/core/time";

import { notifyGroupFor } from "./groups";
import { type PushFetch, type PushMessage, type PushOutcome, sendWebPush } from "./send";
import type { VapidKeys } from "./vapid";

/**
 * The push dispatcher (ARCHITECTURE §9, WORKFLOWS §9a; kickoff 5 decision 5). Runs inside
 * `/api/cron/push-dispatch` every minute (the Worker cron) and right after a transition
 * (`after()`), against the SQL side of 5.2 (migration `push_dispatch`):
 *
 *   claim  → app.push_claim(now, limit): holds rows in quiet hours, leases the due ones and the
 *            released held ones (one summary per person), FOR UPDATE SKIP LOCKED
 *   send   → every active subscription of the recipient (app.push_targets)
 *   record → app.push_record(ids, sent | retry | failed, error)
 *            app.push_subscription_result(id, sent | gone | error) per device
 *
 * A person with no active device: `failed` with `no_subscription` (the seam step 3's email
 * fallback reads: an actionable kind queues an email there). Push off (no VAPID keys): nothing
 * is claimed, so the rows wait and go out once the keys exist. Every database call is behind
 * `PushStore`, so the tests run the whole loop with fakes and a fake fetch.
 */
export interface ClaimedItem {
  deliveryIds: string[];
  recipientId: string;
  notificationId: string | null;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  attempts: number;
  isSummary: boolean;
  heldCount: number;
}

export interface PushTargetRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushStore {
  claim(now: Date, limit: number): Promise<ClaimedItem[]>;
  targets(recipientId: string): Promise<PushTargetRow[]>;
  record(
    deliveryIds: string[],
    outcome: "sent" | "retry" | "failed",
    error: string | null,
    now: Date,
  ): Promise<void>;
  subscriptionResult(subscriptionId: string, outcome: PushOutcome, now: Date): Promise<void>;
}

export interface DispatchReport {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  noSubscription: number;
  devices: { sent: number; gone: number; error: number };
}

/** The Worker's CPU budget is small: a run sends at most this many items, the cron catches up. */
export const DISPATCH_LIMIT = 40;
/** The history page, the summary's link and the fallback of a row without one. */
export const NOTIFICATIONS_PATH = "/notifications";

export function messageFor(item: ClaimedItem): PushMessage {
  return {
    title: item.title,
    body: item.body,
    url: item.link ?? NOTIFICATIONS_PATH,
    tag: item.isSummary
      ? `summary:${item.recipientId}`
      : `n:${item.notificationId ?? item.deliveryIds[0]}`,
    notificationId: item.notificationId,
    group: notifyGroupFor(item.kind, item.isSummary),
  };
}

export async function runPushDispatch(input: {
  store: PushStore;
  vapid: VapidKeys;
  fetch: PushFetch;
  now?: Date;
  limit?: number;
  /** Plain http on the loopback host (the e2e fake push service); `pushLoopbackAllowed()`. */
  allowLoopback?: boolean;
  /** Told about an item that threw; the run goes on with the next one. */
  onItemError?: (error: unknown) => void;
}): Promise<DispatchReport> {
  const now = input.now ?? systemClock();
  const report: DispatchReport = {
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    noSubscription: 0,
    devices: { sent: 0, gone: 0, error: 0 },
  };
  const items = await input.store.claim(now, input.limit ?? DISPATCH_LIMIT);
  report.claimed = items.length;
  for (const item of items) {
    // One item that throws (a store call, a device's answer) never stops the run for everyone
    // else (5A review M1): it is recorded as a retry, so it fails at the last backoff like any
    // error, and the email pass after this run still happens.
    try {
      await dispatchItem(item, input, now, report);
    } catch (error) {
      input.onItemError?.(error);
      try {
        await input.store.record(item.deliveryIds, "retry", "dispatch_error", now);
        report.retried += 1;
      } catch (recordError) {
        // The lease expires and the next run claims it again (attempts counted by the claim).
        input.onItemError?.(recordError);
      }
    }
  }
  return report;
}

async function dispatchItem(
  item: ClaimedItem,
  input: {
    store: PushStore;
    vapid: VapidKeys;
    fetch: PushFetch;
    allowLoopback?: boolean;
    onItemError?: (error: unknown) => void;
  },
  now: Date,
  report: DispatchReport,
): Promise<void> {
  const targets = await input.store.targets(item.recipientId);
  if (targets.length === 0) {
    await input.store.record(item.deliveryIds, "failed", "no_subscription", now);
    report.noSubscription += 1;
    report.failed += 1;
    return;
  }
  const message = messageFor(item);
  let accepted = 0;
  let gone = 0;
  let lastDetail: string | null = null;
  for (const target of targets) {
    // sendWebPush never throws: a poisoned subscription is an `error` for that device alone.
    const result = await sendWebPush({
      target,
      message,
      vapid: input.vapid,
      fetch: input.fetch,
      allowLoopback: input.allowLoopback ?? false,
    });
    report.devices[result.outcome] += 1;
    try {
      await input.store.subscriptionResult(target.id, result.outcome, now);
    } catch (error) {
      // The device's bookkeeping failing must not cost the other devices their push.
      input.onItemError?.(error);
    }
    if (result.outcome === "sent") accepted += 1;
    else if (result.outcome === "gone") gone += 1;
    else lastDetail = result.detail;
  }
  // One device accepting it is the notification delivered; a device that is gone is the
  // subscription's problem, not the row's. Every device gone means the person has no device
  // any more (the same seam as none at all); anything else is retried with backoff.
  if (accepted > 0) {
    await input.store.record(item.deliveryIds, "sent", null, now);
    report.sent += 1;
  } else if (gone === targets.length) {
    await input.store.record(item.deliveryIds, "failed", "no_subscription", now);
    report.noSubscription += 1;
    report.failed += 1;
  } else {
    await input.store.record(item.deliveryIds, "retry", lastDetail ?? "no device accepted it", now);
    report.retried += 1;
  }
}
