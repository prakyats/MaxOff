import {
  captureException as sentryCaptureException,
  captureMessage as sentryCaptureMessage,
} from "@sentry/core";

import { flushInBackground } from "./flush";

type ExceptionHint = Parameters<typeof sentryCaptureException>[1];
type MessageLevel = Parameters<typeof sentryCaptureMessage>[1];

/**
 * Reports an error the server already handled: a server action that threw something unexpected
 * (`core/errors` `action()`), a cron job, a count that could not be read. Server-only
 * (`@sentry/cloudflare` on the Worker, ADR-0014; the browser's boundaries use `client.ts`). The
 * event goes through the scrubber wired in `options.ts` (ARCHITECTURE §18.2) and is flushed
 * before the Worker stops. Returns the event id, the only thing safe to put in a log line.
 */
export function captureException(error: unknown, hint?: ExceptionHint): string {
  const eventId = sentryCaptureException(error, hint);
  flushInBackground();
  return eventId;
}

/** A handled condition worth knowing about that is not an exception (same scrubber). */
export function captureMessage(message: string, level?: MessageLevel): string {
  const eventId = sentryCaptureMessage(message, level);
  flushInBackground();
  return eventId;
}
