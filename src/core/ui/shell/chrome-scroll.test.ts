import { describe, expect, it } from "vitest";

import {
  CHROME_ALWAYS_VISIBLE_ABOVE,
  CHROME_SCROLL_THRESHOLD,
  type ChromeState,
  INITIAL_CHROME_STATE,
  nextChromeState,
} from "./chrome-scroll";

/** Replays a series of scroll positions and returns the state after the last one. */
function scrollThrough(positions: number[], from: ChromeState = INITIAL_CHROME_STATE): ChromeState {
  return positions.reduce(nextChromeState, from);
}

/** Scrolls far enough down that the bar is hidden, which most cases start from. */
function scrolledAway(): ChromeState {
  const state = scrollThrough([0, 200, 400]);
  expect(state.hidden).toBe(true);
  return state;
}

describe("nextChromeState", () => {
  it("keeps the bar while the page is near the top", () => {
    for (const y of [0, 10, CHROME_ALWAYS_VISIBLE_ABOVE]) {
      expect(nextChromeState(INITIAL_CHROME_STATE, y).hidden).toBe(false);
    }
  });

  it("ignores a wobble: a few pixels either way changes nothing", () => {
    const away = scrolledAway();
    // Down and up by less than the threshold, repeatedly: the bar must not flicker.
    const wobbled = scrollThrough([405, 400, 406, 401, 404], away);
    expect(wobbled.hidden).toBe(true);

    const shown = scrollThrough([400, 395, 399, 394, 398], { ...away, hidden: false });
    expect(shown.hidden).toBe(false);
  });

  it("hides on a slow drag down only once the threshold is passed", () => {
    // Already reading, bar shown, part-way down the page.
    const reading: ChromeState = { hidden: false, travel: 0, lastY: 100 };
    // Below the threshold in total, a few pixels at a time.
    const short = scrollThrough([104, 108, 110], reading);
    expect(short.travel).toBeLessThan(CHROME_SCROLL_THRESHOLD);
    expect(short.hidden).toBe(false);
    // The same drag continued past it.
    expect(scrollThrough([112, 114], short).hidden).toBe(true);
  });

  it("hides on a fast flick down in a single event", () => {
    const flicked = scrollThrough([100, 100 + CHROME_SCROLL_THRESHOLD * 40]);
    expect(flicked.hidden).toBe(true);
  });

  it("reveals on a fast flick up in a single event", () => {
    const away = scrolledAway();
    const flicked = nextChromeState(away, away.lastY - 600);
    expect(flicked.hidden).toBe(false);
  });

  it("reveals after a short flick up, without repaying the distance scrolled down", () => {
    const away = scrollThrough([0, 100, 400, 900]);
    expect(away.hidden).toBe(true);
    // 15px back up is enough, even though 900px went down.
    expect(nextChromeState(away, 885).hidden).toBe(false);
  });

  it("always shows the bar again at the top of the page", () => {
    const away = scrolledAway();
    expect(nextChromeState(away, 0).hidden).toBe(false);
    expect(nextChromeState(away, CHROME_ALWAYS_VISIBLE_ABOVE - 1).hidden).toBe(false);
  });

  it("treats iOS rubber-band overscroll at the top as the top, not as an upward flick", () => {
    const state = nextChromeState(scrolledAway(), -120);
    expect(state.hidden).toBe(false);
    expect(state.lastY).toBe(0);
    // And the next real scroll starts measuring from 0, not from -120.
    expect(nextChromeState(state, 40).hidden).toBe(false);
  });

  it("never reports a negative last position, whatever the browser says", () => {
    for (const y of [-1, -500, 0, 10]) {
      expect(nextChromeState(INITIAL_CHROME_STATE, y).lastY).toBeGreaterThanOrEqual(0);
    }
  });

  it("does nothing on a repeated identical position", () => {
    const away = scrolledAway();
    expect(nextChromeState(away, away.lastY)).toEqual({ ...away, travel: 0 });
  });
});
