import { timingSafeEqual } from "node:crypto";

import { captureException } from "@/core/observability/capture";

/**
 * The gate of every `/api/cron/*` route (ARCHITECTURE §11; extracted from `storage-cleanup` in
 * 5.2): the Worker's `scheduled` handler presents `CRON_SECRET` as a bearer token; nothing
 * else may run a job. `/api/*` is public in the proxy, so the secret is the whole gate: unset
 * means 401 for every caller (the job never runs), reported once so a deployed environment
 * does not stay silent.
 */
let reportedMissingSecret = false;

export function cronSecret(): string | null {
  const value = process.env.CRON_SECRET?.trim();
  return value ? value : null;
}

export function cronAuthorised(request: Request): boolean {
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
