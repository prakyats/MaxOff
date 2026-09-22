import { observabilityEnv } from "./env";
import { scrubBreadcrumb, scrubEvent } from "./scrub";

export type SentryRuntime = "server" | "edge" | "client";

/**
 * On staging the server-side SDK logs what it does (init, capture, flush, transport errors)
 * to Workers Logs, so the pipeline can be verified after a deploy (README → "Confirming the
 * Sentry pipeline"). Never in production (log volume, and the logs would repeat scrubbed
 * event data) and never in the browser.
 */
export function isSentryDebugEnabled(runtime: SentryRuntime, appEnv: string | undefined): boolean {
  return runtime !== "client" && appEnv === "staging";
}

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
    debug: isSentryDebugEnabled(runtime, env.appEnv),
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
