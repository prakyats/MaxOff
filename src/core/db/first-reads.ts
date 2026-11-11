/**
 * The reads a request sends first (ARCHITECTURE §19 "Six connections": the member row, the push
 * status and the own day, which every byte of a signed-in screen waits for), and the promise
 * every later client's first request waits for. Pure: `core/db/server.ts` keeps one per request
 * (React `cache()`), `core/auth/server.ts` holds while an early read is leaving.
 *
 * Why a hold and not a shorter chain (v1.9 speed gate, 2026-11-03): a Worker sets off at most
 * six subrequests at a time, in `fetch()` call order, and a screen's first wave is 11 or 12
 * reads started in one tick by the layout and the page. Which `fetch()` is called first was a
 * race between promise chains (the early reads' short one against the session client's load),
 * decided differently by Node and by the Worker: locally the early reads mostly won, on staging
 * the Owner's Approvals first byte took two round trips in most samples. Now the order is built,
 * not raced: a client made while an early read is leaving sends nothing until that read has left.
 */
/**
 * The longest a client waits for the first reads to leave (advisor, v2.0 X2 review): the hold
 * only orders requests, so it must never hang a page. A first-byte read leaves within a few
 * microtasks; one whose `left` never fires (a bug, a later change) costs a client at most this,
 * and the request then simply loses the start-order race, as it could on v1.9.
 */
export const FIRST_READS_WAIT_MS = 50;

/** `fn`, callable any number of times, run once (a `left` told twice is harmless, X2 review). */
export function once(fn: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    fn();
  };
}

export class FirstReads {
  private readonly held: Promise<void>[] = [];

  /** Holds every later first request until `left` settles (either way: a failure holds nothing). */
  hold(left: Promise<unknown>): void {
    this.held.push(
      left.then(
        () => undefined,
        () => undefined,
      ),
    );
  }

  /**
   * Settles once every read held so far has left, or after `limitMs` (`FIRST_READS_WAIT_MS`),
   * whichever comes first; at once when nothing is held.
   */
  wait(limitMs: number = FIRST_READS_WAIT_MS): Promise<void> {
    if (this.held.length === 0) return Promise.resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const valve = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, limitMs);
    });
    return Promise.race([Promise.all(this.held).then(() => undefined), valve]).finally(() => {
      clearTimeout(timer);
    });
  }
}
