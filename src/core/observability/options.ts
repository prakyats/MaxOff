import { observabilityEnv } from "./env";
import { scrubBreadcrumb, scrubEvent } from "./scrub";
import { scrubMetric } from "./web-vitals";

export type SentryRuntime = "server" | "edge" | "client";

/**
 * The options every `Sentry.init` shares (ARCHITECTURE §18). Errors only: no tracing, no
 * session replay, no profiling, no PII. With no DSN the SDK stays off, so local runs and CI
 * never talk to Sentry. One exception to "errors only": the browser sends the real-user speed
 * measures as metrics (v7.0 unit 1, `web-vitals.ts`), scrubbed to their route, role and rating.
 */
export function sentryOptions(runtime: SentryRuntime) {
  const env = observabilityEnv();
  return {
    dsn: env.dsn ?? "",
    enabled: env.dsn !== undefined,
    environment: env.appEnv,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    maxBreadcrumbs: 30,
    initialScope: { tags: { runtime } },
    // Never `debug: true` here: the SDK logger prints the raw, unscrubbed event message to
    // Workers Logs. To troubleshoot the pipeline, add it on a branch, deploy to staging, and
    // remove it again (see PROGRESS.md, phase 0 review).
    debug: false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    enableMetrics: runtime === "client",
    beforeSendMetric: scrubMetric,
  };
}
