import { cronAuthorised } from "@/core/http/cron-auth";
import { captureException } from "@/core/observability/capture";
import { storageCleanupJob } from "@/core/storage/cleanup";
import { systemClock } from "@/core/time";

/**
 * `storage_cleanup` (WORKFLOWS §8, ARCHITECTURE §11): the first Worker cron trigger. The
 * Worker's `scheduled` handler (`worker/index.js`) calls this route with the shared secret
 * (`core/http/cron-auth`, shared with `push-dispatch` since 5.2); nothing else may. Runs with
 * the service client (no user), deletes the objects of rows archived 30 days ago and of
 * uploads still pending after 24 hours, marks them `deleted`, and says what it did.
 * Idempotent: a second run right after finds nothing.
 */
async function run(request: Request): Promise<Response> {
  if (!cronAuthorised(request)) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const report = await storageCleanupJob(systemClock());
    if (report.failed.length > 0) {
      captureException(
        new Error(`storage_cleanup: ${report.failed.length} object(s) could not be deleted`),
      );
    }
    return Response.json({ job: "storage_cleanup", ...report });
  } catch (error) {
    const eventId = captureException(error);
    console.error(`[cron] storage_cleanup failed (sentry event ${eventId})`);
    return Response.json({ error: "INTERNAL", eventId }, { status: 500 });
  }
}

/** POST only: a job that deletes is never reachable by a safe method; the Worker POSTs. */
export const POST = run;
