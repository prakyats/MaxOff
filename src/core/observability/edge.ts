import { initServerSentry } from "./server";

/**
 * Called once from `src/instrumentation.ts` on the edge runtime (no route uses it today: the
 * proxy runs on Node). The same Worker SDK and options as the server runtime (ADR-0014).
 */
export function initEdgeSentry(): void {
  initServerSentry("edge");
}
