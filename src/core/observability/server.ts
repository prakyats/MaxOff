import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "./options";
import { makeFetchTransport } from "./transport";

/**
 * Default Node integrations that read the filesystem or attach the inspector. On Cloudflare
 * Workers (`nodejs_compat`) those calls never answer for the bundled Worker, so event
 * processing stalls until the 2 s flush timeout and the error is lost, while client reports
 * (which skip processing) still arrive. Proved on staging on 2026-09-22 (ARCHITECTURE §18.2).
 * Source context comes from the uploaded source maps instead; there is no OS or module list
 * worth reporting from a Worker.
 */
export const WORKER_UNSAFE_INTEGRATIONS: readonly string[] = [
  "ContextLines",
  "Modules",
  "LocalVariablesAsync",
  "Context",
];

export function workerSafeIntegrations<T extends { name: string }>(defaults: T[]): T[] {
  return defaults.filter((integration) => !WORKER_UNSAFE_INTEGRATIONS.includes(integration.name));
}

/** Called once from `src/instrumentation.ts` on the Node.js runtime (the Worker). */
export function initServerSentry(): void {
  Sentry.init({
    ...sentryOptions("server"),
    // Local variables of stack frames are never attached: the scrubber does not walk them.
    includeLocalVariables: false,
    integrations: workerSafeIntegrations,
    // Platform fetch instead of node:https (see transport.ts).
    transport: makeFetchTransport,
  });
}
