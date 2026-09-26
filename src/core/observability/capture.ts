import * as Sentry from "@sentry/nextjs";

/**
 * Reports an error the app already handled: a server action that threw something unexpected
 * (`core/errors` `action()`), or a client error boundary. Runtime-neutral: `@sentry/nextjs`
 * resolves to the right SDK build on the server, the edge and in the browser, and the event
 * goes through the scrubber wired in `options.ts` (ARCHITECTURE §18.2). Returns the event id,
 * which is the only thing safe to put in a log line.
 */
export const captureException = Sentry.captureException;

/** A handled condition worth knowing about that is not an exception (same scrubber). */
export const captureMessage = Sentry.captureMessage;
