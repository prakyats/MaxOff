import { systemClock } from "@/core/time";

import type { EmailSender } from "./email";
import { renderNotificationEmail } from "./email-content";

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
  for (const item of items) {
    if (!input.sender) {
      await input.store.record(item.deliveryId, "failed", "not_configured", now);
      report.notConfigured += 1;
      report.failed += 1;
      continue;
    }
    const content = renderNotificationEmail({
      title: item.title,
      body: item.body,
      link: item.link,
      origin: input.origin,
    });
    const result = await input.sender.send({ to: item.email, ...content });
    if (result.ok) {
      await input.store.record(item.deliveryId, "sent", null, now);
      report.sent += 1;
    } else if (result.reason === "not_configured") {
      await input.store.record(item.deliveryId, "failed", "not_configured", now);
      report.notConfigured += 1;
      report.failed += 1;
    } else if (isRetryable(result.status)) {
      await input.store.record(
        item.deliveryId,
        "retry",
        result.status === undefined ? "resend_unreachable" : `resend_${result.status}`,
        now,
      );
      report.retried += 1;
    } else {
      await input.store.record(item.deliveryId, "failed", `resend_${result.status}`, now);
      report.failed += 1;
    }
  }
  return report;
}
