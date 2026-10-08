import * as Sentry from "@sentry/nextjs";

import { browserBeforeSend } from "./offline-filter";
import { sentryOptions } from "./options";

/**
 * The browser SDK, loaded on demand by `client.ts` (task 2.8): once the page is idle, or at once
 * when an error arrives first. Nothing else imports `@sentry/nextjs` in the browser. A fetch that
 * failed offline is dropped before the scrubber (`offline-filter.ts`).
 */
export function initClientSdk() {
  const options = sentryOptions("client");
  Sentry.init({ ...options, beforeSend: browserBeforeSend(options.beforeSend) });
  return Sentry;
}
