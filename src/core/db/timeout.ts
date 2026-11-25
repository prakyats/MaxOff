import { DB_TIMEOUT_MARKER } from "@/core/errors/db-timeout";

export { DB_TIMEOUT_MARKER, isDbTimeout } from "@/core/errors/db-timeout";

/**
 * The server's database requests give up after 10 s (v7.0 unit 2, audit 12; ROADMAP v2.1 unit 2):
 * a Worker → Supabase request that never answers used to hold the screen or the action until the
 * Worker itself was cut off, with nothing to tell the person. Now it fails as a timeout, which the
 * action answers with "MaxOff didn't get an answer, so this may not have saved. Try again."
 * (`DB_TIMEOUT_MESSAGE`) and a screen with its retryable error state.
 *
 * A write can still land after the timeout (the request is abandoned, not undone), which is why
 * the creates people make often carry a request key (`request_keys`): their Retry is answered with
 * what the first one made. A state change sent again is refused by its own state check.
 */
export const DB_TIMEOUT_MS = 10_000;

export function withTimeout(base: typeof fetch, ms: number = DB_TIMEOUT_MS): typeof fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(ms);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return base(input, { ...init, signal }).catch((error: unknown) => {
      if (timeout.aborted && !init?.signal?.aborted) {
        const timedOut = new Error(DB_TIMEOUT_MARKER);
        timedOut.name = "TimeoutError";
        throw timedOut;
      }
      throw error;
    });
  };
}
