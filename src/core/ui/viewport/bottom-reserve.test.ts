import { describe, expect, it } from "vitest";

import { atPageEnd, changeBottomReserve, keepAtEnd, type ScrollMetrics } from "./bottom-reserve";

/** A page of `height` px in an 800 px viewport, scrolled to `top`; `grow` adds to its height. */
function fakePage(height: number, top: number) {
  const state = { height, top, scrolls: [] as number[] };
  return {
    state,
    page: {
      metrics: (): ScrollMetrics => ({ top: state.top, height: state.height, viewport: 800 }),
      scrollTo: (to: number) => {
        state.scrolls.push(to);
        state.top = to;
      },
    },
  };
}

describe("atPageEnd", () => {
  it("is at the end within a pixel of the bottom of a page that scrolls", () => {
    expect(atPageEnd({ top: 1200, height: 2000, viewport: 800 })).toBe(true);
    expect(atPageEnd({ top: 1199.5, height: 2000, viewport: 800 })).toBe(true);
    expect(atPageEnd({ top: 1190, height: 2000, viewport: 800 })).toBe(false);
  });

  it("leaves a page that fits on the screen at its top", () => {
    expect(atPageEnd({ top: 0, height: 800, viewport: 800 })).toBe(false);
    expect(atPageEnd({ top: 0, height: 600, viewport: 800 })).toBe(false);
  });
});

describe("keepAtEnd", () => {
  it("scrolls to the new end only when the person was at the end and the page grew", () => {
    expect(keepAtEnd(true, { top: 1200, height: 2052, viewport: 800 })).toBe(1252);
    expect(keepAtEnd(false, { top: 1200, height: 2052, viewport: 800 })).toBeNull();
    expect(keepAtEnd(true, { top: 1200, height: 2000, viewport: 800 })).toBeNull();
    expect(keepAtEnd(true, { top: 1200, height: 1900, viewport: 800 })).toBeNull();
  });
});

describe("changeBottomReserve", () => {
  it("keeps a person at the end at the end when the reserve grows (the offline band appears)", () => {
    const { state, page } = fakePage(2000, 1200);
    changeBottomReserve(() => {
      state.height += 52;
    }, page);
    expect(state.scrolls).toEqual([1252]);
  });

  it("leaves a person who scrolled elsewhere where they are", () => {
    const { state, page } = fakePage(2000, 400);
    changeBottomReserve(() => {
      state.height += 52;
    }, page);
    expect(state.scrolls).toEqual([]);
  });

  it("never scrolls when the reserve shrinks or stays", () => {
    const { state, page } = fakePage(2000, 1200);
    changeBottomReserve(() => {
      state.height -= 52;
      state.top = 1148;
    }, page);
    changeBottomReserve(() => {}, page);
    expect(state.scrolls).toEqual([]);
  });

  it("never scrolls a page that fit on the screen", () => {
    const { state, page } = fakePage(800, 0);
    changeBottomReserve(() => {
      state.height += 52;
    }, page);
    expect(state.scrolls).toEqual([]);
  });
});
