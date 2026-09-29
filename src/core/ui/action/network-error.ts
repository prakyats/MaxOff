/**
 * Whether a thrown error means the request never got an answer from MaxOff (the phone lost its
 * connection, the request timed out at the network, the server was unreachable), as opposed to a
 * bug. Server actions answer refusals with a `Result`, never a throw, so a throw is either this
 * or a real error; a real error still goes to the error boundary (ARCHITECTURE §14.1).
 *
 * The browsers' own words for a failed `fetch`: Chrome "Failed to fetch", Firefox "NetworkError
 * when attempting to fetch resource.", Safari "Load failed"; and Next's when the answer was not
 * its own (a gateway's HTML error page): "An unexpected response was received from the server."
 */
const NETWORK_MESSAGES = [
  "failed to fetch",
  "networkerror",
  "load failed",
  "network request failed",
  "an unexpected response was received from the server",
];

export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return NETWORK_MESSAGES.some((known) => message.includes(known));
}

export const NETWORK_ERROR_MESSAGE = "Couldn't reach MaxOff. Check your connection and try again.";
export const NETWORK_ERROR_CREATE_MESSAGE =
  "Couldn't reach MaxOff, so it may or may not have been saved. Check before trying again.";
export const SLOW_MESSAGE = "Still working… slow connection";

/** After this long a pending action says the connection is slow (owner 2026-09-28). */
export const ACTION_SLOW_MS = 8_000;
