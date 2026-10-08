import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/**
 * A browser fetch that fails because the device is offline is the offline state (the app shows
 * it: ARCHITECTURE §14.1), not an error to report (Sentry MAXOFF-8/-9, ARCHITECTURE §18.2). Each
 * browser words it its own way, always as a `TypeError`.
 */
export const OFFLINE_FETCH_MESSAGES: readonly string[] = [
  "Load failed", // Safari
  "Failed to fetch", // Chrome, Edge
  "NetworkError when attempting to fetch resource.", // Firefox
  "network error", // Chrome, a body cut off mid-stream
];

/** The thrown error's type and message: the original exception, else the event's own. */
function thrown(event: ErrorEvent, hint: EventHint): { type?: string; message?: string } {
  const original = hint.originalException;
  if (original instanceof Error) return { type: original.name, message: original.message };
  const primary = event.exception?.values?.at(-1);
  return {
    ...(primary?.type !== undefined ? { type: primary.type } : {}),
    ...(primary?.value !== undefined ? { message: primary.value } : {}),
  };
}

/**
 * True for a fetch that failed for want of a network: a `TypeError` whose message is one of the
 * browsers' network messages exactly, or starts with one while the browser says it is offline
 * (a browser may add the host). Every other error is kept, a `TypeError` with any other message
 * included.
 */
export function isOfflineFetchFailure(
  event: ErrorEvent,
  hint: EventHint,
  online: boolean | undefined,
): boolean {
  const { type, message } = thrown(event, hint);
  if (type !== "TypeError" || message === undefined) return false;
  if (OFFLINE_FETCH_MESSAGES.includes(message)) return true;
  return online === false && OFFLINE_FETCH_MESSAGES.some((known) => message.startsWith(known));
}

/**
 * The browser SDK's `beforeSend`: drops an offline fetch failure, then hands every other event to
 * the shared scrubber. `navigator.onLine` is read when the event is sent.
 */
export function browserBeforeSend(scrub: (event: ErrorEvent) => ErrorEvent | null) {
  return (event: ErrorEvent, hint: EventHint): ErrorEvent | null => {
    const online = typeof navigator === "undefined" ? undefined : navigator.onLine;
    return isOfflineFetchFailure(event, hint, online) ? null : scrub(event);
  };
}
