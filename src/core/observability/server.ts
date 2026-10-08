import { CloudflareClient, getDefaultIntegrations } from "@sentry/cloudflare";
import {
  basename,
  type Client,
  createStackParser,
  type Event,
  type EventHint,
  getDefaultCurrentScope,
  initAndBind,
  nodeStackLineParser,
  type StackLineParser,
} from "@sentry/core";

import { sentryOptions, type SentryRuntime } from "./options";
import { makeFetchTransport } from "./transport";

/**
 * Server Sentry on the Worker: `@sentry/cloudflare` (ADR-0014, task 6.5b), no longer the Node SDK
 * of `@sentry/nextjs` with its OpenTelemetry stack. The browser keeps `@sentry/nextjs`
 * (`client-sdk.ts`). The options are the ones every runtime shares (`options.ts`: the same
 * `beforeSend` / `beforeBreadcrumb` scrubber, no PII, no tracing).
 *
 * One client per bundle, created by `instrumentation.ts` the first time Next registers it (the
 * Node middleware and the server function each do). Each request runs in its own isolation scope
 * (`worker/index.js` → `request-scope.ts`), so `setSentryUser` never leaks between requests.
 */

/**
 * Cloudflare defaults the Worker leaves out, for parity with what the Node SDK did here:
 * - `Dedupe` drops an error identical to the one just before it (same message and stack): two
 *   members hitting the same broken screen in a row would count once. The Node SDK has no such
 *   default, and Sentry groups repeats itself.
 * - `Fetch` would patch the global `fetch`: a breadcrumb for every outgoing request (a push
 *   endpoint's path carries the device's token) and `sentry-trace` / `baggage` headers on calls
 *   to Supabase, Resend and the push services. The Node SDK's fetch instrumentation listens to
 *   undici's diagnostics channels, which never fire on workerd, so it did neither.
 * - `Hono` instruments a framework MaxOff does not use.
 * - `HttpServer` only serves `wrapRequestHandler`, which the Worker does not use (one client per
 *   bundle instead of one per request; see `request-scope.ts`).
 */
export const WORKER_EXCLUDED_INTEGRATIONS: readonly string[] = [
  "Dedupe",
  "Fetch",
  "Hono",
  "HttpServer",
];

export function workerIntegrations<T extends { name: string }>(defaults: T[]): T[] {
  return defaults.filter((integration) => !WORKER_EXCLUDED_INTEGRATIONS.includes(integration.name));
}

/**
 * The Workers stack-line parser of `@sentry/cloudflare` (`vendor/stacktrace.ts`, not exported):
 * Node's line format, every frame in app, absolute paths rooted at `/`.
 */
function workersStackLineParser(): StackLineParser {
  const [priority, parseLine] = nodeStackLineParser((filename) =>
    filename ? basename(filename, ".js") : undefined,
  );
  return [
    priority,
    (line) => {
      const frame = parseLine(line);
      if (frame) {
        const { filename } = frame;
        if (filename !== undefined) {
          frame.abs_path = filename.startsWith("/") ? filename : `/${filename}`;
        }
        frame.in_app = filename !== undefined;
      }
      return frame;
    },
  ];
}

/**
 * `@sentry/nextjs`'s "DropReactControlFlowErrors" processor, kept for parity: React's postpone
 * signal and its Suspense exceptions are control flow, not errors.
 */
export function dropReactControlFlowErrors(event: Event, hint: EventHint): Event | null {
  if (event.type !== undefined) return event;
  const original = hint.originalException;
  if (
    typeof original === "object" &&
    original !== null &&
    "$$typeof" in original &&
    original.$$typeof === Symbol.for("react.postpone")
  ) {
    return null;
  }
  const message = event.exception?.values?.[0]?.value;
  if (
    message?.includes("Suspense Exception: This is not a real error!") ||
    message?.includes("Suspense Exception: This is not a real error, and should not leak")
  ) {
    return null;
  }
  return event;
}

/** The Worker client's options (pure, so the tests read exactly what `initServerSentry` uses). */
export function workerClientOptions(runtime: Extract<SentryRuntime, "server" | "edge">) {
  const shared = sentryOptions(runtime);
  return {
    ...shared,
    // Local variables of stack frames are never attached: the scrubber does not walk them.
    includeLocalVariables: false,
    // No `sentry-trace` / `baggage` header on any outgoing request.
    tracePropagationTargets: [],
    integrations: workerIntegrations(getDefaultIntegrations(shared)),
    stackParser: createStackParser(workersStackLineParser()),
    // Platform fetch, sending at once (see transport.ts); flushed through `waitUntil`.
    transport: makeFetchTransport,
  };
}

/**
 * Called from `src/instrumentation.ts` on the Worker (both Next runtimes). `initAndBind` rather
 * than the SDK's own `init`: errors only, so no OpenTelemetry tracer is registered (`init` would
 * register one that turns every Next.js span into a Sentry span). The client is bound to
 * the scope Next registered from **and** to the default scope every later request's isolation
 * scope is cloned from: Next registers lazily, inside the first request's scope.
 */
export function initServerSentry(runtime: "server" | "edge" = "server"): Client {
  const client = initAndBind(CloudflareClient, workerClientOptions(runtime));
  client.addEventProcessor(dropReactControlFlowErrors);
  getDefaultCurrentScope().setClient(client);
  return client;
}
