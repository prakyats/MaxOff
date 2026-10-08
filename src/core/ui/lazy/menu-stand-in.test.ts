import { describe, expect, it } from "vitest";
import type { PointerEvent } from "react";

import { menuStandInPress } from "./menu-stand-in";

function press(over: { button?: number; ctrlKey?: boolean } = {}) {
  let prevented = false;
  const event = {
    button: over.button ?? 0,
    ctrlKey: over.ctrlKey ?? false,
    preventDefault: () => {
      prevented = true;
    },
  } as unknown as PointerEvent<HTMLElement>;
  return { event, prevented: () => prevented };
}

describe("a lazily loaded menu's stand-in takes a press as Radix's trigger does", () => {
  it("opens on the primary button's pointerdown and prevents its default", () => {
    let opened = 0;
    const handlers = menuStandInPress(() => (opened += 1));
    const down = press();
    handlers.onPointerDown(down.event);
    expect(opened).toBe(1);
    expect(down.prevented()).toBe(true);
  });

  it("ignores another button and Ctrl-press (macOS right click), leaving their default", () => {
    let opened = 0;
    const handlers = menuStandInPress(() => (opened += 1));
    for (const over of [{ button: 2 }, { button: 1 }, { ctrlKey: true }]) {
      const down = press(over);
      handlers.onPointerDown(down.event);
      expect(down.prevented()).toBe(false);
    }
    expect(opened).toBe(0);
  });

  it("opens on a click, for the keyboard", () => {
    let opened = 0;
    menuStandInPress(() => (opened += 1)).onClick();
    expect(opened).toBe(1);
  });
});
