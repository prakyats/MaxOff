import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "./options";

/** Called once from `src/instrumentation-client.ts` in the browser. */
export function initClientSentry(): void {
  Sentry.init(sentryOptions("client"));
}

/** Next.js calls this on App Router navigations; Sentry uses it to name the current route. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

export { captureException } from "./capture";
