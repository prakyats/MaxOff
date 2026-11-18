import { driveSpaceCheckJob } from "@/core/drive/server";
import { cronAuthorised } from "@/core/http/cron-auth";
import { captureException } from "@/core/observability/capture";
import { systemClock } from "@/core/time";

/**
 * `drive_space_check` (v4.0, WORKFLOWS §8): daily at 09:05 IST, the Worker's `scheduled` handler
 * (`worker/index.js`) calls this route with the shared cron secret; nothing else may. Reads each
 * connected Google Drive's used and total space with the service client; the database tells the
 * Owner once at 80 % and once at 90 %, and a refused grant becomes "needs reconnect". Without the
 * Google settings it does nothing. Idempotent: a second run sends no second alert.
 */
async function run(request: Request): Promise<Response> {
  if (!cronAuthorised(request)) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const report = await driveSpaceCheckJob(systemClock);
    if (report.failed.length > 0) {
      captureException(
        new Error(`drive_space_check: ${report.failed.length} account(s) could not be checked`),
      );
    }
    return Response.json({ job: "drive_space_check", ...report });
  } catch (error) {
    const eventId = captureException(error);
    console.error(`[cron] drive_space_check failed (sentry event ${eventId})`);
    return Response.json({ error: "INTERNAL", eventId }, { status: 500 });
  }
}

/** POST only, like every cron route: the Worker POSTs. */
export const POST = run;
