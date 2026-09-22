import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "./options";

/** Called once from `src/instrumentation.ts` on the Node.js runtime. */
export function initServerSentry(): void {
  // Local variables of stack frames are never attached: the scrubber does not walk them.
  Sentry.init({ ...sentryOptions("server"), includeLocalVariables: false });
}
