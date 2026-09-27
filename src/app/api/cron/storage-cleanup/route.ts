import { timingSafeEqual } from "node:crypto";

import { captureException } from "@/core/observability/capture";
import { storageCleanupJob } from "@/core/storage/cleanup";
import { cronSecret } from "@/core/storage/env";
import { systemClock } from "@/core/time";

/**
 * `storage_cleanup` (WORKFLOWS §8, ARCHITECTURE §11): the first Worker cron trigger. The
 * Worker's `scheduled` handler (`worker/index.js`) calls this route with the shared secret;
 * nothing else may. Runs with the service client (no user), deletes the objects of rows
 * archived 30 days ago and of uploads still pending after 24 hours, marks them `deleted`, and
 * says what it did. Idempotent: a second run right after finds nothing.
 *
 * `/api/*` is public in the proxy, so the secret is the whole gate: unset means 401 for every
 * caller (the job never runs), reported once so a deployed environment does not stay silent.
 */
let reportedMissingSecret = false;

function authorised(request: Request): boolean {
  const secret = cronSecret();
  if (!secret) {
    if (!reportedMissingSecret && process.env.NEXT_PUBLIC_APP_ENV !== "local") {
      reportedMissingSecret = true;
      captureException(new Error("CRON_SECRET is not set: cron routes are refused"));
    }
    return false;
  }
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function run(request: Request): Promise<Response> {
  if (!authorised(request)) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
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

export const POST = run;
export const GET = run;
