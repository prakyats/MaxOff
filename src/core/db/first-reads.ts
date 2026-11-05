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

  /** Settles once every read held so far has left; at once when nothing is held. */
  wait(): Promise<void> {
    if (this.held.length === 0) return Promise.resolve();
    return Promise.all(this.held).then(() => undefined);
  }
}
