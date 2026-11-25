/**
 * The server's database timeout as an error (v7.0 unit 2; the timeout itself is
 * `core/db/timeout.ts`): the marker its error carries, how to know it, and what the person reads.
 */
export const DB_TIMEOUT_MARKER = "MaxOff database request timed out";

export const DB_TIMEOUT_MESSAGE =
  "MaxOff didn't get an answer, so this may not have saved. Try again.";

/** A PostgREST answer (postgrest-js reports it as `TimeoutError: <marker>`), or a thrown error. */
export function isDbTimeout(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.includes(DB_TIMEOUT_MARKER);
}
