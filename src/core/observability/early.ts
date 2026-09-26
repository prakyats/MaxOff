/**
 * The browser's error reporting before the Sentry SDK has loaded (task 2.8, ARCHITECTURE §18.2).
 *
 * The SDK is the largest thing a first load used to carry (~410 KB decompressed), and it was
 * parsed and run before hydration on every screen. It now loads once the page is idle, but the
 * errors that matter most happen during load and hydration, when a bad deploy breaks. So this
 * tiny reporter goes first: it queues uncaught errors and rejections from the very start, loads
 * the SDK at once when the first one arrives, and hands the queue over once the SDK is up. From
 * then on the SDK's own global handlers take over and this one steps aside.
 *
 * No Sentry import here: the SDK arrives through `load`, so this module costs the first load
 * almost nothing and is unit-tested against a fake.
 */

/** The part of the SDK the reporter drives. `load()` resolves with it initialised. */
export interface ReporterSdk {
  captureException(error: unknown, hint?: { mechanism: { type: string; handled: boolean } }): void;
  setUser(user: { id: string } | null): void;
}

type Source = "onerror" | "onunhandledrejection" | "boundary";

interface Queued {
  error: unknown;
  source: Source;
}

/** The window events the reporter listens to (a real `window` in the app, a fake in tests). */
export interface ErrorEventTarget {
  addEventListener(type: "error" | "unhandledrejection", listener: (event: Event) => void): void;
  removeEventListener(type: "error" | "unhandledrejection", listener: (event: Event) => void): void;
}

/** Past this many queued errors, more are dropped: one broken loop must not grow memory. */
export const EARLY_QUEUE_CAP = 20;

export interface EarlyReporter {
  /** Starts listening. `schedule` decides when the SDK loads if nothing goes wrong first. */
  start(schedule: (load: () => void) => void): void;
  /** Reports an error a boundary caught; loads the SDK if it is not there yet. */
  capture(error: unknown): void;
  /** Tags later reports with the member id (applied once the SDK is there). */
  setUser(id: string | null): void;
  /** The SDK once loaded, for callers that forward to it (route naming). */
  readonly sdk: ReporterSdk | undefined;
}

export function createEarlyReporter(
  target: ErrorEventTarget,
  load: () => Promise<ReporterSdk>,
): EarlyReporter {
  const queue: Queued[] = [];
  let sdk: ReporterSdk | undefined;
  let loading = false;
  let user: string | null | undefined;

  function enqueue(error: unknown, source: Source) {
    if (queue.length < EARLY_QUEUE_CAP) queue.push({ error, source });
    loadNow();
  }

  const onError = (event: Event) => {
    const { error, message } = event as ErrorEvent;
    enqueue(error ?? message, "onerror");
  };
  const onRejection = (event: Event) => {
    enqueue((event as PromiseRejectionEvent).reason, "onunhandledrejection");
  };

  function loadNow() {
    if (loading) return;
    loading = true;
    load().then(
      (loaded) => {
        sdk = loaded;
        // The SDK's own handlers are installed by now (`init` is synchronous). An error thrown
        // in the microtask between the two could be reported twice; nothing is lost.
        target.removeEventListener("error", onError);
        target.removeEventListener("unhandledrejection", onRejection);
        if (user !== undefined) loaded.setUser(user ? { id: user } : null);
        for (const { error, source } of queue.splice(0)) {
          loaded.captureException(
            error,
            source === "boundary" ? undefined : { mechanism: { type: source, handled: false } },
          );
        }
      },
      () => {
        // The chunk could not load (offline, a deploy replaced it): keep queueing; the next
        // error or boundary capture tries again. Nothing to report it with.
        loading = false;
      },
    );
  }

  return {
    start(schedule) {
      target.addEventListener("error", onError);
      target.addEventListener("unhandledrejection", onRejection);
      schedule(loadNow);
    },
    capture(error) {
      if (sdk) sdk.captureException(error);
      else enqueue(error, "boundary");
    },
    setUser(id) {
      user = id;
      sdk?.setUser(id ? { id } : null);
    },
    get sdk() {
      return sdk;
    },
  };
}

/**
 * Loads the SDK once the page has finished loading and the main thread is idle (at most 3 s
 * after `load`), so it never competes with hydration. Safari has no `requestIdleCallback`.
 */
export function whenIdleAfterLoad(win: Window): (load: () => void) => void {
  return (load) => {
    // Typed as always present, but Safari only has it from 26.2 on.
    const requestIdle = win.requestIdleCallback as Window["requestIdleCallback"] | undefined;
    const idle = () =>
      requestIdle ? requestIdle.call(win, load, { timeout: 3000 }) : win.setTimeout(load, 1000);
    if (win.document.readyState === "complete") idle();
    else win.addEventListener("load", idle, { once: true });
  };
}
