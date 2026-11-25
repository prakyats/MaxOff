import { cronAuthorised } from "@/core/http/cron-auth";
import { captureException } from "@/core/observability/capture";
import { systemClock } from "@/core/time";
import { uploadWatchJob } from "@/modules/uploads";

/**
 * `upload_watch` (v4.5, WORKFLOWS §8): every minute, the Worker's `scheduled` handler
 * (`worker/index.js`, beside `push-dispatch` on the same trigger) calls this route with the shared
 * cron secret; nothing else may. Asks Google each quiet session's offset, records files that
 * finished after their page went quiet, then sends "Stuck" and "Looks finished" once each.
 * Idempotent: the database sends each signal once. POST only, like every cron route.
 */
export async function POST(request: Request): Promise<Response> {
  if (!cronAuthorised(request)) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const report = await uploadWatchJob(systemClock);
    return Response.json({ job: "upload_watch", ...report });
  } catch (error) {
    const eventId = captureException(error);
    console.error(`[cron] upload_watch failed (sentry event ${eventId})`);
    return Response.json({ error: "INTERNAL", eventId }, { status: 500 });
  }
}
