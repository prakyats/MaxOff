import * as Sentry from "@sentry/nextjs";

/**
 * Next.js instrumentation hook: initialises Sentry once per runtime (ARCHITECTURE §18) and
 * says once, at start-up, when email is not configured (task 1.2). That line is a warning
 * everywhere and an error-level line in production; it never throws (decided 2026-09-22).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initServerSentry } = await import("@/core/observability/server");
    initServerSentry();

    const { emailStartupWarning } = await import("@/core/notifications/env");
    const warning = emailStartupWarning();
    if (warning) {
      const log = process.env.NEXT_PUBLIC_APP_ENV === "production" ? console.error : console.warn;
      log(warning);
    }
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    const { initEdgeSentry } = await import("@/core/observability/edge");
    initEdgeSentry();
  }
}

/** Server-side rendering and route-handler errors, reported through the same scrubber. */
export const onRequestError = Sentry.captureRequestError;
