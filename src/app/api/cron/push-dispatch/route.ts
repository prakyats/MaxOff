import { cronAuthorised } from "@/core/http/cron-auth";
import { dispatchEmail, dispatchPush } from "@/core/notifications/push/dispatch";
import { captureException } from "@/core/observability/capture";

/**
 * `push_dispatch` (WORKFLOWS §8 and §9a, ARCHITECTURE §9; task 5.2): the Worker cron every
 * minute (`worker/index.js` → this route with `CRON_SECRET`). Sends the queued push deliveries
 * that are due, retries with backoff, holds the ones inside quiet hours and releases the held
 * ones as one summary per person once the window is over (kickoff 5 decision 5). Idempotent
 * and safe when two runs overlap: `push_claim()` leases rows with FOR UPDATE SKIP LOCKED. Push
 * off (no VAPID keys) answers with what was skipped and sends nothing. POST only, like every
 * job route; the transitions' `after()` call the same dispatcher for a smaller batch. Then the
 * notification email (always_email kinds; actionable kinds for people with no working push;
 * the 20 per person / 90 per org daily ceilings), reported under `email`.
 */
export async function POST(request: Request): Promise<Response> {
  if (!cronAuthorised(request)) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const report = await dispatchPush();
    // Email after push (5.2 step 3): an actionable row whose push just went out is not mailed.
    // Its own failure is reported, never hiding the push run's result.
    const email = await dispatchEmail().catch((error: unknown) => {
      const eventId = captureException(error);
      console.error(`[cron] email dispatch failed (sentry event ${eventId})`);
      return { error: "INTERNAL", eventId } as const;
    });
    return Response.json({ job: "push_dispatch", ...report, email });
  } catch (error) {
    const eventId = captureException(error);
    console.error(`[cron] push_dispatch failed (sentry event ${eventId})`);
    return Response.json({ error: "INTERNAL", eventId }, { status: 500 });
  }
}
