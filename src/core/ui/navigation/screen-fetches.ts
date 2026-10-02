/**
 * The router's screen fetches, observed (`NavProgress` patches `fetch` once and reports each one
 * here). Pull-to-refresh uses it to know when its refresh has really answered: Next queues a
 * `router.refresh()` behind any router action already in flight and runs it outside the caller's
 * transition, so a transition's pending state can end before the refresh has even started (found
 * on CI: the spinner never showed, 2026-09-29).
 *
 * It also counts the router's fetches **in flight** (screens and actions' answers), for the view
 * controls' address (`view-address.ts`): a fetch is in flight from its request until its answer
 * has been read to the end or has failed, and the work the router does on that answer has run.
 * An action whose answer changes nothing (no redirect, no revalidation) ends on its headers; one
 * the router commits ends once committed too.
 */

type Listener = (path: string) => void;

const listeners = new Set<Listener>();

/** Called by `NavProgress` when a screen fetch (not a prefetch, not an action) has answered. */
export function noteScreenFetchSettled(path: string): void {
  for (const listener of listeners) listener(path);
}

/**
 * Resolves when the next screen fetch for `path` (pathname and search) has answered, or after
 * `timeoutMs` if none does (Next drops a queued refresh when a navigation supersedes it).
 */
export function nextScreenFetch(path: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      listeners.delete(listener);
      window.clearTimeout(timer);
      resolve();
    };
    const listener: Listener = (settled) => {
      if (settled === path) done();
    };
    const timer = window.setTimeout(done, timeoutMs);
    listeners.add(listener);
  });
}

let inFlight = 0;
const idleListeners = new Set<() => void>();

/** Whether any router fetch is in flight now. */
export function routerFetchesInFlight(): boolean {
  return inFlight > 0;
}

/**
 * Called by `NavProgress` as the router sends a fetch. The returned function ends it, once: the
 * last one ended tells every `whenRouterFetchesIdle` waiter.
 */
export function noteRouterFetchStarted(): () => void {
  inFlight += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    inFlight -= 1;
    if (inFlight > 0) return;
    const waiting = [...idleListeners];
    idleListeners.clear();
    for (const listener of waiting) listener();
  };
}

/** Runs `listener` once, when no router fetch is in flight (now, if none is). */
export function whenRouterFetchesIdle(listener: () => void): void {
  if (inFlight === 0) listener();
  else idleListeners.add(listener);
}

let commits = 0;
const commitListeners = new Set<() => void>();

/**
 * Called as the router commits a state: Next writes its own history entry (`__NA`) on every
 * commit (`HistoryUpdater`), and `NavProgress` reports each one here.
 */
export function noteRouterCommitted(): void {
  commits += 1;
  const waiting = [...commitListeners];
  commitListeners.clear();
  for (const listener of waiting) listener();
}

/** What the router does with an answer, which decides when its fetch has ended. */
export type AnswerUse =
  /** A screen: the router acts on it as it streams in. Ends once read to the end. */
  | "screen"
  /**
   * A server action's answer: one that revalidates or redirects is committed by the router only
   * after it has arrived (a new history entry when the address moved meanwhile), so it ends
   * once read **and** committed. One that changes nothing ends on its headers.
   */
  | "action";

/**
 * Ends a router fetch on its own completion, never after a timer: a fetch that ends late ends
 * late. Completion is the answer read to the end (a copy of the body, so the router reads the
 * original untouched) or failed (offline, an error, an abort); for an action's answer that the
 * router commits, also that commit. Then after the current task, so the work the router queued
 * on the answer (its microtasks: writing the data, deciding whether the tree still matches) has
 * run first.
 */
export function endOnCompletion(
  response: Promise<Response>,
  end: () => void,
  use: AnswerUse = "screen",
  /** An action's answer the router will not act on (no redirect, no revalidation). */
  changesNothing: (answer: Response) => boolean = () => false,
): void {
  const afterThisTask = () => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      end();
    };
    channel.port2.postMessage(null);
  };
  response.then((answer) => {
    if (use === "action" && changesNothing(answer)) {
      afterThisTask();
      return;
    }
    // An action's answer the router commits: wait for that commit as well (a failed answer is
    // never committed, so it ends once read).
    const awaitCommit = use === "action" && answer.ok;
    const committedBefore = commits;
    let read = false;
    let committed = !awaitCommit;
    const maybeEnd = () => {
      if (read && committed) afterThisTask();
    };
    if (awaitCommit) {
      const onCommit = () => {
        committed = true;
        maybeEnd();
      };
      if (commits > committedBefore) committed = true;
      else commitListeners.add(onCommit);
    }
    const finishRead = (failed: boolean) => {
      read = true;
      if (failed) committed = true;
      maybeEnd();
    };
    const copy = answer.clone().body;
    if (!copy) finishRead(false);
    else
      copy.pipeTo(new WritableStream()).then(
        () => finishRead(false),
        () => finishRead(true),
      );
  }, afterThisTask);
}

/** Tests only: nothing in flight. */
export function resetRouterFetches(): void {
  inFlight = 0;
  idleListeners.clear();
  commits = 0;
  commitListeners.clear();
}
