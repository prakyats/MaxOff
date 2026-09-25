import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "./options";

/**
 * The browser SDK, loaded on demand by `client.ts` (task 2.8): once the page is idle, or at once
 * when an error arrives first. Nothing else imports `@sentry/nextjs` in the browser.
 */
export function initClientSdk() {
  Sentry.init(sentryOptions("client"));
  return Sentry;
}
