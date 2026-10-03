import { systemClock } from "@/core/time";

import { DIGEST_KIND, parseDigestPayload, renderDigestEmail } from "./digest-content";
import type { EmailSender } from "./email";
import { type NotificationEmail, renderCombinedEmail } from "./email-content";

/**
 * The email half of the dispatcher (task 5.2; WORKFLOWS §9a, kickoff 5 decisions 6, 7 and 10;
 * migration `email_dispatch`). Runs in the same cron route as push, right after it, and in the
 * same `after()` of a transition:
 *
 *   claim  → email_claim(now, limit): queues the email rows a notification needs (always_email
 *            kinds; actionable kinds when the person has no working push; nothing else), applies
 *            the per-person and org-wide daily ceilings under a lock (over either: skipped_cap)
 *            and leases what may go, with the address
 *   send   → Resend through `EmailSender` (plain fetch)
 *   record → email_record(id, sent | retry | failed, error): 429, 5xx and network failures
 *            retry with the push backoff; any other 4xx fails at once
 *
 * **One email per person per run (5.3):** the claim gives a person's always-emailed rows of the run
 * one `batchId`; they go as one email (`renderCombinedEmail`: the most urgent item names the
 * subject) and each row records the same outcome. A row without a batch is an email of its own.
 *
 * **The Owner's morning summary (5B slice 7)** is always an email of its own, rendered from its
 * payload (`renderDigestEmail`); a payload that is not a digest's is recorded failed
 * `invalid_payload` at once (and reported), never retried, never sent half-rendered.
 *
 * No `RESEND_API_KEY` (`sender` null): every claimed row is recorded failed `not_configured`
 * (visible in the deliveries, never counted against the ceilings), nothing is sent and nothing
 * throws. The store is an interface, so the tests run the loop with fakes.
 */
export interface ClaimedEmail {
  deliveryId: string;
  recipientId: string;
  email: string;
  notificationId: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  attempts: number;
  /** The rows sent as one email (5.3); null: an email of its own. */
  batchId: string | null;
  /** `notifications.escalation_level` (0 for anything but an escalation). */
  escalationLevel: number;
  /** `notifications.payload`: read only for the Owner's digest (5B), whose email is built from it. */
  payload?: unknown;
}

export interface EmailStore {
  claim(now: Date, limit: number): Promise<ClaimedEmail[]>;
  record(
    deliveryId: string,
    outcome: "sent" | "retry" | "failed",
    error: string | null,
    now: Date,
  ): Promise<void>;
}

export interface EmailDispatchReport {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  notConfigured: number;
}

/** Resend's free plan allows 100 a day; a run sends a small batch and the cron catches up. */
export const EMAIL_DISPATCH_LIMIT = 20;

/** Whether a Resend answer is worth trying again: rate limited, a server error, no answer. */
export function isRetryable(status: number | undefined): boolean {
  return status === undefined || status === 429 || status >= 500;
}

export async function runEmailDispatch(input: {
  store: EmailStore;
  sender: EmailSender | null;
  origin: string;
  now?: Date;
  limit?: number;
  /** Told about an item that threw; the run goes on with the next one. */
  onItemError?: (error: unknown) => void;
}): Promise<EmailDispatchReport> {
  const now = input.now ?? systemClock();
  const report: EmailDispatchReport = {
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    notConfigured: 0,
  };
  const items = await input.store.claim(now, input.limit ?? EMAIL_DISPATCH_LIMIT);
  report.claimed = items.length;
  for (const group of emailGroups(items)) {
    // One email that throws (rendering, the sender, a store call) never stops the run for the
    // others (the email twin of 5A review M1): its rows are recorded as a retry, so email_record's
    // backoff fails them after the last attempt like any other error.
    try {
      await dispatchEmailGroup(group, input, now, report);
    } catch (error) {
      input.onItemError?.(error);
      for (const item of group) {
        try {
          await input.store.record(item.deliveryId, "retry", "dispatch_error", now);
          report.retried += 1;
        } catch (recordError) {
          // The lease expires and the next run claims it again (attempts counted by the claim).
          input.onItemError?.(recordError);
        }
      }
    }
  }
  return report;
}

/** The claimed rows as emails: a batch's rows together, every other row alone; claim order kept. */
export function emailGroups(items: readonly ClaimedEmail[]): ClaimedEmail[][] {
  const groups: ClaimedEmail[][] = [];
  const byBatch = new Map<string, ClaimedEmail[]>();
  for (const item of items) {
    if (!item.batchId) {
      groups.push([item]);
      continue;
    }
    const group = byBatch.get(item.batchId);
    if (group) group.push(item);
    else {
      const fresh = [item];
      byBatch.set(item.batchId, fresh);
      groups.push(fresh);
    }
  }
  return groups;
}

async function dispatchEmailGroup(
  group: readonly ClaimedEmail[],
  input: {
    store: EmailStore;
    sender: EmailSender | null;
    origin: string;
    onItemError?: (error: unknown) => void;
  },
  now: Date,
  report: EmailDispatchReport,
): Promise<void> {
  const [first] = group;
  if (!first) return;
  const recordAll = async (outcome: "sent" | "retry" | "failed", error: string | null) => {
    for (const item of group) await input.store.record(item.deliveryId, outcome, error, now);
  };
  if (!input.sender) {
    await recordAll("failed", "not_configured");
    report.notConfigured += group.length;
    report.failed += group.length;
    return;
  }
  let content: NotificationEmail;
  if (first.kind === DIGEST_KIND) {
    const payload = parseDigestPayload(first.payload);
    if (!payload) {
      input.onItemError?.(new Error("owner_digest: the payload is not a digest"));
      await recordAll("failed", "invalid_payload");
      report.failed += group.length;
      return;
    }
    content = renderDigestEmail(payload, input.origin);
  } else {
    content = renderCombinedEmail({ items: group, origin: input.origin });
  }
  const result = await input.sender.send({ to: first.email, ...content });
  if (result.ok) {
    await recordAll("sent", null);
    report.sent += group.length;
  } else if (result.reason === "not_configured") {
    await recordAll("failed", "not_configured");
    report.notConfigured += group.length;
    report.failed += group.length;
  } else if (isRetryable(result.status)) {
    await recordAll(
      "retry",
      result.status === undefined ? "resend_unreachable" : `resend_${result.status}`,
    );
    report.retried += group.length;
  } else {
    await recordAll("failed", `resend_${result.status}`);
    report.failed += group.length;
  }
}
