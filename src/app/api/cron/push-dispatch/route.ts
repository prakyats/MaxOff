import { cronAuthorised } from "@/core/http/cron-auth";
import { dispatchPush } from "@/core/notifications/push/dispatch";
import { captureException } from "@/core/observability/capture";

/**
 * `push_dispatch` (WORKFLOWS §8 and §9a, ARCHITECTURE §9; task 5.2): the Worker cron every
 * minute (`worker/index.js` → this route with `CRON_SECRET`). Sends the queued push deliveries
 * that are due, retries with backoff, holds the ones inside quiet hours and releases the held
 * ones as one summary per person once the window is over (kickoff 5 decision 5). Idempotent
 * and safe when two runs overlap: `push_claim()` leases rows with FOR UPDATE SKIP LOCKED. Push
 * off (no VAPID keys) answers with what was skipped and sends nothing. POST only, like every
 * job route; the transitions' `after()` call the same dispatcher for a smaller batch.
 */
export async function POST(request: Request): Promise<Response> {
  if (!cronAuthorised(request)) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const report = await dispatchPush();
    return Response.json({ job: "push_dispatch", ...report });
  } catch (error) {
    const eventId = captureException(error);
    console.error(`[cron] push_dispatch failed (sentry event ${eventId})`);
    return Response.json({ error: "INTERNAL", eventId }, { status: 500 });
  }
}
