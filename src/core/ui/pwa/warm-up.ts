/**
 * Warm the Worker early (P2, 2026-10-15; ARCHITECTURE §19). A Worker isolate that has not served
 * for a while is gone, and the next request pays its cold start (1.5–4.5 s on the platform, unit
 * P). When the app comes back into view the person is about to tap, so one tiny request goes
 * ahead of them: `GET /api/warm` (204, no body, no database, no data, no cookie;
 * `app/api/warm/route.ts`), and their first real tap lands on a warm isolate over an open
 * connection.
 *
 * - **When:** the app becoming visible (`visibilitychange` to visible), its window regaining
 *   focus, and a page shown again from the back-forward cache (`pageshow`). The first load needs
 *   none: its own document request was the warm-up, so the throttle starts from it.
 * - **At most once per `WARM_INTERVAL_MS`**, on the wall clock (a phone's monotonic clock stops
 *   while it sleeps), never while hidden (no polling of any kind) and never offline.
 * - Production builds only (`pwa-after-page.tsx`), loaded after the page (`AfterPage`), so no screen's
 *   first-load JavaScript grows.
 */

export const WARM_URL = "/api/warm";
/** Not more often than this: an isolate stays warm for well over 30 s after a request. */
export const WARM_INTERVAL_MS = 30_000;

/** Whether to send the warm-up now. */
export function shouldWarm({
  now,
  lastWarm,
  visible,
  online,
}: {
  now: number;
  lastWarm: number;
  visible: boolean;
  online: boolean;
}): boolean {
  return visible && online && now - lastWarm >= WARM_INTERVAL_MS;
}

type Listener = () => void;
type Target = {
  addEventListener: (type: string, listener: Listener) => void;
  removeEventListener: (type: string, listener: Listener) => void;
};

/** What the warm-up reads and listens to: the browser's, or a test's. */
export interface WarmUpEnv {
  document: Target & { visibilityState: string };
  window: Target;
  navigator: { onLine: boolean };
  /** The wall clock, in ms. */
  now: () => number;
  /** Sends the request; must never throw. */
  send: () => void;
}

/**
 * Listens for the app coming back into view and sends the warm-up when the throttle allows.
 * `startedAt` is when the server last answered this page (its document). Returns the cleanup.
 */
export function startWarmUp(env: WarmUpEnv, startedAt: number): () => void {
  let lastWarm = startedAt;
  const onReturn = () => {
    const now = env.now();
    const visible = env.document.visibilityState === "visible";
    if (!shouldWarm({ now, lastWarm, visible, online: env.navigator.onLine })) return;
    lastWarm = now;
    env.send();
  };
  env.document.addEventListener("visibilitychange", onReturn);
  env.window.addEventListener("focus", onReturn);
  env.window.addEventListener("pageshow", onReturn);
  return () => {
    env.document.removeEventListener("visibilitychange", onReturn);
    env.window.removeEventListener("focus", onReturn);
    env.window.removeEventListener("pageshow", onReturn);
  };
}

/** The request itself: same origin, never cached, its answer ignored. */
export function sendWarmUp(): void {
  fetch(WARM_URL, { cache: "no-store", credentials: "same-origin", keepalive: true }).catch(
    () => undefined,
  );
}
