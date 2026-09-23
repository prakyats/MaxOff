/**
 * The rule behind the mobile brand bar: it slides away when you scroll down and comes back when
 * you scroll up (ARCHITECTURE §14.1, task 1.5), so a phone gives its height back to content
 * without putting the account menu and Log out behind a scroll-to-top.
 *
 * It is a pure reducer on purpose. "Does a fast flick hide it, and does a 5px wobble leave it
 * alone?" is a question about numbers, and a unit test answers it in milliseconds where a real
 * device answers it once. `mobile-chrome.tsx` is the only caller; it feeds real scroll events in.
 */

/** Movement in one direction, in px, before the bar reacts. Below this a wobble changes nothing. */
export const CHROME_SCROLL_THRESHOLD = 12;

/** Above the fold the bar is always shown: there is nothing to gain by hiding it. */
export const CHROME_ALWAYS_VISIBLE_ABOVE = 48;

export type ChromeState = {
  hidden: boolean;
  /** Movement accumulated since the last flip, signed: positive is downward. */
  travel: number;
  /** The `scrollY` of the previous event, so the caller keeps no state of its own. */
  lastY: number;
};

export const INITIAL_CHROME_STATE: ChromeState = { hidden: false, travel: 0, lastY: 0 };

/**
 * The next state for a scroll position. `scrollY` is the raw value: iOS rubber-banding reports
 * negative numbers at the top and values past the end at the bottom, and both must be harmless.
 *
 * A flick is not a special case — it simply arrives as one large delta and crosses the threshold
 * on its first event, which is why there is no velocity term to tune.
 */
export function nextChromeState(previous: ChromeState, scrollY: number): ChromeState {
  // Rubber-band overscroll at the top reads as a negative offset; treat it as the top.
  const y = Math.max(0, scrollY);
  const delta = y - previous.lastY;

  if (y <= CHROME_ALWAYS_VISIBLE_ABOVE) {
    return { hidden: false, travel: 0, lastY: y };
  }

  // Travel only accumulates while the direction holds; a turn starts the count again, so
  // "scrolled down 200px then flicked up 15px" reveals the bar rather than waiting out the 200.
  const sameDirection = delta === 0 || Math.sign(delta) === Math.sign(previous.travel);
  const travel = sameDirection ? previous.travel + delta : delta;

  if (travel >= CHROME_SCROLL_THRESHOLD) return { hidden: true, travel: 0, lastY: y };
  if (travel <= -CHROME_SCROLL_THRESHOLD) return { hidden: false, travel: 0, lastY: y };
  return { ...previous, travel, lastY: y };
}
