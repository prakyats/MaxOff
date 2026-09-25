import { describe, expect, it } from "vitest";

import { BACK_CASES, TAB_CASES, TAB_HOME, TAB_TOP_LEVEL, VIEW_CASES } from "./move-cases";
import { backMove, tabMove, viewMove } from "./moves";

describe("navigation moves, the hydrated app (ARCHITECTURE §14.2)", () => {
  it.each(BACK_CASES)("back control: $name", ({ index, expected }) => {
    expect(backMove(index)).toBe(expected);
  });

  it.each(VIEW_CASES)("view control: $name", ({ expected }) => {
    expect(viewMove()).toBe(expected);
  });

  it.each(TAB_CASES)("tabs: $name", ({ input, expected }) => {
    expect(tabMove({ ...input, home: TAB_HOME, topLevel: TAB_TOP_LEVEL })).toBe(expected);
  });
});
