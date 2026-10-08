import { setAsyncLocalStorageAsyncContextStrategy, withIsolationScope } from "@sentry/cloudflare";

/**
 * Each request on the Worker gets its own Sentry isolation scope (ADR-0014). `setSentryUser`
 * writes the member id to the isolation scope, so without this every request in an isolate would
 * share one scope, and a report could carry the member of a different, concurrent request.
 *
 * `worker/index.js` imports this module, which installs the AsyncLocalStorage strategy before
 * anything else runs, and wraps every `fetch` in `runInRequestScope`. The Next bundles carry their
 * own copy of `@sentry/core`; every copy of one version shares one global carrier, so the
 * strategy, the scopes and the client set here and in `instrumentation.ts` are the same objects.
 * `@sentry/cloudflare` and `@sentry/core` are pinned to one exact version in `package.json` for
 * that reason.
 */
setAsyncLocalStorageAsyncContextStrategy();

export function runInRequestScope<T>(handler: () => T): T {
  return withIsolationScope(() => handler());
}
