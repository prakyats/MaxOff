import { describe, expect, it } from "vitest";

import { BACK_CASES, TAB_CASES, TAB_HOME, TAB_TOP_LEVEL, VIEW_CASES } from "./move-cases";
import { backSteps, originMatches, tabMove, viewMove } from "./moves";

describe("navigation moves, the hydrated app (ARCHITECTURE §14.2)", () => {
  it.each(BACK_CASES)("back control: $name", ({ paths, parent, from = [], expected }) => {
    expect(backSteps(paths, parent, from)).toBe(expected);
  });

  it("an origin is a pathname, or a prefix written with /*", () => {
    expect(originMatches("/calendar", "/calendar")).toBe(true);
    expect(originMatches("/calendar", "/calendar/x")).toBe(false);
    expect(originMatches("/reports/end-of-day/*", "/reports/end-of-day/2026-10-01")).toBe(true);
    expect(originMatches("/reports/end-of-day/*", "/reports/end-of-day")).toBe(false);
  });

  it.each(VIEW_CASES)("view control: $name", ({ expected }) => {
    expect(viewMove()).toBe(expected);
  });

  it.each(TAB_CASES)("tabs: $name", ({ input, expected }) => {
    expect(tabMove({ ...input, home: TAB_HOME, topLevel: TAB_TOP_LEVEL })).toBe(expected);
  });
});
