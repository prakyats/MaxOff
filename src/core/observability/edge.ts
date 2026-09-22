import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "./options";
import { makeFetchTransport } from "./transport";

/** Called once from `src/instrumentation.ts` on the edge runtime (proxy, edge routes). */
export function initEdgeSentry(): void {
  Sentry.init({ ...sentryOptions("edge"), transport: makeFetchTransport });
}
