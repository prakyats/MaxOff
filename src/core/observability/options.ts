import { observabilityEnv } from "./env";
import { scrubBreadcrumb, scrubEvent } from "./scrub";

export type SentryRuntime = "server" | "edge" | "client";

/**
 * The options every `Sentry.init` shares (ARCHITECTURE §18). Errors only: no tracing, no
 * session replay, no profiling, no PII. With no DSN the SDK stays off, so local runs and CI
 * never talk to Sentry.
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
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
