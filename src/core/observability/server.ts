import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "./options";
import { makeFetchTransport } from "./transport";

/** Called once from `src/instrumentation.ts` on the Node.js runtime (the Worker). */
export function initServerSentry(): void {
  Sentry.init({
    ...sentryOptions("server"),
    // Local variables of stack frames are never attached: the scrubber does not walk them.
    includeLocalVariables: false,
    // The default node:https transport hangs on Workers (see transport.ts).
    transport: makeFetchTransport,
  });
}
