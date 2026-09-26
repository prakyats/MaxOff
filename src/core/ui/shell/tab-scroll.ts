/**
 * Each tab root keeps its own scroll (ARCHITECTURE §14.2 g, task 2.7b), installed only, like the
 * rest of `tab-history`: leave Today halfway down, look at Approvals, come back, and Today is
 * where you left it, as in a native app with a bottom bar.
 *
 * Drill-down is not handled here: back from a detail is a history move, and the browser and Next
 * restore that entry's scroll themselves.
 *
 * Module state, like `pushedFromHome`: a reload starts every tab at the top, which is what a
 * reload means.
 */
const positions = new Map<string, number>();

/** Remembers where `tab` was scrolled to, as it is left. */
export function saveTabScroll(tab: string, y: number): void {
  positions.set(tab, Math.max(0, Math.round(y)));
}

/** Where `tab` was left, once: a second arrival without leaving again starts from the top. */
export function takeTabScroll(tab: string): number | undefined {
  const y = positions.get(tab);
  positions.delete(tab);
  return y;
}

/** The furthest a page of `scrollHeight` can scroll in a window `viewportHeight` tall. */
export function reachable(y: number, scrollHeight: number, viewportHeight: number): number {
  return Math.min(y, Math.max(0, scrollHeight - viewportHeight));
}

/**
 * How long a restore keeps the tab at its place after arriving. The page may still be streaming
 * in (the `loading.tsx` skeleton first, then the rows), and Next scrolls a new page to the top
 * on the commit that shows it, so one `scrollTo` is not enough: the place is re-applied every
 * frame until this runs out. Any touch, wheel or key hands the scroll back to the person at once.
 */
export const RESTORE_WINDOW_MS = 1000;

const HAND_BACK_EVENTS = ["touchstart", "wheel", "keydown", "pointerdown"] as const;

/**
 * Keeps the window scrolled to `y` for `RESTORE_WINDOW_MS`, or until the person takes over; then
 * `onDone`. Not on the returned stop, which is a cleanup (StrictMode runs the effect again).
 */
export function holdScroll(y: number, onDone: () => void): () => void {
  const until = performance.now() + RESTORE_WINDOW_MS;
  let frame = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    for (const type of HAND_BACK_EVENTS) window.removeEventListener(type, finish);
  };
  const step = () => {
    const target = reachable(y, document.documentElement.scrollHeight, window.innerHeight);
    if (Math.abs(window.scrollY - target) > 1) window.scrollTo(0, target);
    if (performance.now() < until) frame = requestAnimationFrame(step);
    else finish();
  };
  const finish = () => {
    stop();
    onDone();
  };
  for (const type of HAND_BACK_EVENTS) window.addEventListener(type, finish, { passive: true });
  step();
  return stop;
}
