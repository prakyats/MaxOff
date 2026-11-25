import * as Sentry from "@sentry/nextjs";

import { browserBeforeSend } from "./offline-filter";
import { sentryOptions } from "./options";
import { viewerRole } from "./viewer-role";
import { startWebVitals } from "./vitals-sdk";

/**
 * The browser SDK, loaded on demand by `client.ts` (task 2.8): once the page is idle, or at once
 * when an error arrives first. Nothing else imports `@sentry/nextjs` in the browser. A fetch that
 * failed offline is dropped before the scrubber (`offline-filter.ts`). The real-user measures
 * start with it (v7.0 unit 1, `vitals-sdk.ts`), so they cost the first load nothing either.
 */
export function initClientSdk() {
  const options = sentryOptions("client");
  Sentry.init({ ...options, beforeSend: browserBeforeSend(options.beforeSend) });
  startWebVitals(Sentry, viewerRole);
  return Sentry;
}
