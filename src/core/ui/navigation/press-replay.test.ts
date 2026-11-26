import { describe, expect, it } from "vitest";

import { type PressEnd, replaysPress } from "./press-replay";

/**
 * The decision behind the head script's press repair (fix-held-press-back): a press the page
 * swapped out from under the pointer is replayed as one click on the replacement, and only then.
 * Each refusal on its own (the advisor's rules, #89).
 */
const BACK: PressEnd = {
  button: 0,
  modified: false,
  kind: "back",
  href: "https://maxoff.test/people",
  excluded: false,
};

describe("replaysPress", () => {
  it("replays a primary press whose link was replaced by one of the same kind and address", () => {
    expect(replaysPress(BACK, { ...BACK }, false)).toBe(true);
    for (const kind of ["view", "tab", "bell"]) {
      expect(replaysPress({ ...BACK, kind }, { ...BACK, kind }, false), kind).toBe(true);
    }
  });

  it("never while the pressed link is still on the page: the browser answers it", () => {
    expect(replaysPress(BACK, BACK, true)).toBe(false);
  });

  it("never without both ends of the press", () => {
    expect(replaysPress(null, BACK, false)).toBe(false);
    expect(replaysPress(BACK, null, false)).toBe(false);
  });

  it("only the primary button: never a middle or right press, at either end", () => {
    expect(replaysPress({ ...BACK, button: 1 }, BACK, false)).toBe(false);
    expect(replaysPress(BACK, { ...BACK, button: 2 }, false)).toBe(false);
  });

  it("never with a modifier key (Ctrl/⌘/Shift/Alt: a new tab or window), at either end", () => {
    expect(replaysPress({ ...BACK, modified: true }, BACK, false)).toBe(false);
    expect(replaysPress(BACK, { ...BACK, modified: true }, false)).toBe(false);
  });

  it("only an enhanced link: never an ordinary link, a button or a field", () => {
    expect(replaysPress({ ...BACK, kind: null }, { ...BACK, kind: null }, false)).toBe(false);
  });

  it("only the same kind at both ends", () => {
    expect(replaysPress(BACK, { ...BACK, kind: "bell" }, false)).toBe(false);
    expect(replaysPress(BACK, { ...BACK, kind: null }, false)).toBe(false);
  });

  it("only the same address at both ends", () => {
    expect(replaysPress(BACK, { ...BACK, href: "https://maxoff.test/today" }, false)).toBe(false);
  });

  it("never a link that opens elsewhere or sits where a press is a write (NEVER_HELD)", () => {
    expect(replaysPress({ ...BACK, excluded: true }, BACK, false)).toBe(false);
    expect(replaysPress(BACK, { ...BACK, excluded: true }, false)).toBe(false);
  });

  it("is self-contained, so the head script can carry its source", () => {
    const carried = new Function(`return (${replaysPress.toString()})`)() as typeof replaysPress;
    expect(carried(BACK, BACK, false)).toBe(true);
    expect(carried(BACK, BACK, true)).toBe(false);
  });
});
