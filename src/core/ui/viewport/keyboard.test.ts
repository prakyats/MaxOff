import { describe, expect, it } from "vitest";

import { isKeyboardOpen, KEYBOARD_OPEN_PX, keyboardState } from "./keyboard";

describe("keyboardState", () => {
  it("is closed with no visual viewport, or one as tall as the layout", () => {
    expect(keyboardState(800, null)).toEqual({ inset: 0, height: 800 });
    expect(keyboardState(800, { height: 800, offsetTop: 0 })).toEqual({ inset: 0, height: 800 });
    expect(isKeyboardOpen(keyboardState(800, { height: 800, offsetTop: 0 }))).toBe(false);
  });

  it("measures the keyboard over the layout viewport's bottom", () => {
    const state = keyboardState(800, { height: 480, offsetTop: 0 });
    expect(state).toEqual({ inset: 320, height: 480 });
    expect(isKeyboardOpen(state)).toBe(true);
  });

  it("allows for a visual viewport iOS scrolled up to keep the field in view", () => {
    // The visible band is 100–580 of an 800px layout: the keyboard covers the last 220px.
    expect(keyboardState(800, { height: 480, offsetTop: 100 })).toEqual({
      inset: 220,
      height: 480,
    });
  });

  it("ignores a browser bar's few pixels and never goes negative", () => {
    expect(isKeyboardOpen(keyboardState(800, { height: 744, offsetTop: 0 }))).toBe(false);
    expect(keyboardState(800, { height: 820, offsetTop: 0 }).inset).toBe(0);
    expect(isKeyboardOpen({ inset: KEYBOARD_OPEN_PX, height: 500 })).toBe(true);
  });
});
