import { flush } from "@sentry/core";

/** How long the reports may take to leave once the response is done (the Node SDK's figure). */
export const FLUSH_TIMEOUT_MS = 2000;

export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * OpenNext keeps each request's Cloudflare context (`env`, `ctx`, `cf`) behind this global
 * symbol (`.open-next/cloudflare/init.js`); `@sentry/nextjs` reached `waitUntil` the same way.
 */
const CLOUDFLARE_CONTEXT = Symbol.for("__cloudflare-context__");

function currentWaitUntil(): WaitUntil | undefined {
  const context = (globalThis as unknown as Record<symbol, { ctx?: WaitUntil } | undefined>)[
    CLOUDFLARE_CONTEXT
  ];
  return typeof context?.ctx?.waitUntil === "function" ? context.ctx : undefined;
}

/**
 * Keeps the Worker alive until the reports captured so far have been sent (ADR-0014): a Worker
 * stops its outstanding work once the response is done unless it is handed to `waitUntil`.
 * Outside a request (unit tests, `next build`) there is nothing to keep alive: it does nothing.
 */
export function flushInBackground(waitUntil: WaitUntil | undefined = currentWaitUntil()): void {
  waitUntil?.waitUntil(
    flush(FLUSH_TIMEOUT_MS).then(
      () => undefined,
      () => undefined,
    ),
  );
}
