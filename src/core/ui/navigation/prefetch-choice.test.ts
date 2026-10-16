import { describe, expect, it } from "vitest";

import { isIntent, PREFETCH_FIRST_ROWS, rowPrefetch, wantsLessData } from "./prefetch-choice";

describe("rowPrefetch: which prefetch a list row makes", () => {
  it("prefetches the first rows in view and the rest on intent", () => {
    const choices = Array.from({ length: 7 }, (_, rank) => rowPrefetch(rank, false));
    expect(choices).toEqual([
      "viewport",
      "viewport",
      "viewport",
      "viewport",
      "intent",
      "intent",
      "intent",
    ]);
    expect(PREFETCH_FIRST_ROWS).toBe(4);
  });

  it("takes another number of first rows", () => {
    expect(rowPrefetch(1, false, 2)).toBe("viewport");
    expect(rowPrefetch(2, false, 2)).toBe("intent");
    expect(rowPrefetch(0, false, 0)).toBe("intent");
  });

  it("never prefetches with data saver on, first rows included", () => {
    expect(rowPrefetch(0, true)).toBe("none");
    expect(rowPrefetch(9, true)).toBe("none");
  });

  it("treats a rank it cannot place as a later row", () => {
    expect(rowPrefetch(-1, false)).toBe("intent");
  });
});

describe("wantsLessData: data saver", () => {
  it("is on only when the browser says so", () => {
    expect(wantsLessData({ saveData: true })).toBe(true);
    expect(wantsLessData({ saveData: false })).toBe(false);
    expect(wantsLessData({})).toBe(false);
    // Safari and Firefox have no `navigator.connection`.
    expect(wantsLessData(undefined)).toBe(false);
    expect(wantsLessData(null)).toBe(false);
  });
});

describe("isIntent: what asks for the prefetch", () => {
  const event = (type: string, pointerType: string, button = 0, isPrimary = true) => ({
    type,
    pointerType,
    button,
    isPrimary,
  });

  it("is a finger, a pen or the main mouse button going down", () => {
    expect(isIntent(event("pointerdown", "touch"), false)).toBe(true);
    expect(isIntent(event("pointerdown", "pen"), false)).toBe(true);
    expect(isIntent(event("pointerdown", "mouse"), false)).toBe(true);
  });

  it("is a mouse coming to rest on the row, never a finger passing over it", () => {
    expect(isIntent(event("pointerenter", "mouse"), false)).toBe(true);
    expect(isIntent(event("pointerenter", "touch"), false)).toBe(false);
  });

  it("is never another button, a second finger, or anything with data saver on", () => {
    expect(isIntent(event("pointerdown", "mouse", 2), false)).toBe(false);
    expect(isIntent(event("pointerdown", "touch", 0, false), false)).toBe(false);
    expect(isIntent(event("pointerdown", "touch"), true)).toBe(false);
    expect(isIntent(event("pointerenter", "mouse"), true)).toBe(false);
  });
});
