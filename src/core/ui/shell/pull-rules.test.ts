import { describe, expect, it } from "vitest";

import { canPull, NO_PULL_ROOTS, pullDistance, PULL_MAX_PX } from "./pull-rules";

const base = {
  tabRoots: ["/today", "/tasks", "/calendar", "/me"],
  scrollY: 0,
  overlayOpen: false,
  editing: false,
  sendWaiting: false,
  now: 100_000,
  lastPull: 0,
};

describe("pull to refresh (ARCHITECTURE §14.2 i)", () => {
  it("pulls on a tab's first screen at the top, nowhere else", () => {
    expect(canPull({ ...base, pathname: "/today" })).toBe(true);
    expect(canPull({ ...base, pathname: "/tasks/123" })).toBe(false);
    expect(canPull({ ...base, pathname: "/today", scrollY: 10 })).toBe(false);
    expect(canPull({ ...base, pathname: "/today", overlayOpen: true })).toBe(false);
  });

  it("is off on the calendar, whose vertical swipe is its own (Kickoff 6 decision 25, 6.4b)", () => {
    expect(NO_PULL_ROOTS).toContain("/calendar");
    expect(canPull({ ...base, pathname: "/calendar" })).toBe(false);
  });

  it("travels half the finger's distance, up to the stop", () => {
    expect(pullDistance(40)).toBe(20);
    expect(pullDistance(-5)).toBe(0);
    expect(pullDistance(1000)).toBe(PULL_MAX_PX);
  });
});
