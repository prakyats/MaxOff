import * as Sentry from "@sentry/nextjs";

/** Next.js instrumentation hook: initialises Sentry once per runtime (ARCHITECTURE §18). */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initServerSentry } = await import("@/core/observability/server");
    initServerSentry();
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    const { initEdgeSentry } = await import("@/core/observability/edge");
    initEdgeSentry();
  }
}

/** Server-side rendering and route-handler errors, reported through the same scrubber. */
export const onRequestError = Sentry.captureRequestError;
