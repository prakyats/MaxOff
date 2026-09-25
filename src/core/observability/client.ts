import type * as SentryBrowser from "@sentry/nextjs";

import { observabilityEnv } from "./env";
import { createEarlyReporter, type EarlyReporter, whenIdleAfterLoad } from "./early";

/**
 * The browser's error reporting (ARCHITECTURE §18.2). The Sentry SDK is not in the first load
 * (task 2.8): `early.ts` queues errors from the start and the SDK arrives when the page is idle
 * or at the first error. With no DSN (local, CI) nothing listens and the SDK never loads.
 */
const reporter: EarlyReporter | undefined =
  typeof window !== "undefined" && observabilityEnv().dsn !== undefined
    ? createEarlyReporter(window, () =>
        import("./client-sdk").then(({ initClientSdk }) => initClientSdk()),
      )
    : undefined;

/** Called once from `src/instrumentation-client.ts` in the browser, before hydration. */
export function initClientSentry(): void {
  reporter?.start(whenIdleAfterLoad(window));
}

/** An error a client boundary caught (Next does not pass those to the global handlers). */
export function captureException(error: unknown): void {
  reporter?.capture(error);
}

/** The member id on browser reports, set by `<SentryUser>` in the signed-in shell. */
export function setClientSentryUser(id: string | null): void {
  reporter?.setUser(id);
}

/**
 * Next calls this on App Router navigations; Sentry uses it to name the current route. Tracing
 * is off (`tracesSampleRate: 0`), so a navigation before the SDK loads loses nothing.
 */
export function onRouterTransitionStart(
  ...args: Parameters<typeof SentryBrowser.captureRouterTransitionStart>
): void {
  const sdk = reporter?.sdk as typeof SentryBrowser | undefined;
  sdk?.captureRouterTransitionStart(...args);
}
