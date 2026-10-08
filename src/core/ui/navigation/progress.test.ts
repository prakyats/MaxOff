import { describe, expect, it } from "vitest";

import { headingElsewhere, type NavMoment, NAV_SETTLE_MS, navigationDone } from "./progress";

/** A navigation that has just begun: nothing fetched, nothing moved. */
const start: NavMoment = {
  moved: false,
  skeleton: false,
  answered: false,
  elsewhere: false,
  idle: true,
  sinceAnswered: 0,
  sinceMoved: 0,
};

describe("headingElsewhere (a tap's own fetch went out before the tap was heard)", () => {
  it("counts a router fetch for another address already in flight when the navigation begins", () => {
    // Next sends the link's fetch from its click handler, before NavProgress's listener runs.
    expect(headingElsewhere(["/leave"], "/my-day")).toBe(true);
  });

  it("a fetch for the address it starts from is a refresh, not a move", () => {
    expect(headingElsewhere(["/my-day"], "/my-day")).toBe(false);
    expect(headingElsewhere([], "/my-day")).toBe(false);
  });

  it("any fetch for another address among several counts", () => {
    expect(headingElsewhere(["/my-day", "/leave?page=2"], "/my-day")).toBe(true);
  });
});

describe("navigationDone (when the bar and data-nav-pending end, §14.2 i)", () => {
  it("a move's answered fetch is not the end while the address has not changed (CI run 37781084919)", () => {
    expect(navigationDone({ ...start, answered: true, elsewhere: true, sinceAnswered: 40 })).toBe(
      false,
    );
  });

  it("a refresh of the screen you are on ends when it answers", () => {
    expect(navigationDone({ ...start, answered: true, sinceAnswered: 1 })).toBe(true);
  });

  it("nothing answered and nothing moved is not the end", () => {
    expect(navigationDone(start)).toBe(false);
    expect(navigationDone({ ...start, elsewhere: true, idle: false })).toBe(false);
  });

  it("the address changed and no skeleton is left: done", () => {
    expect(
      navigationDone({ ...start, moved: true, answered: true, elsewhere: true, sinceMoved: 1 }),
    ).toBe(true);
  });

  it("a skeleton still in main holds the bar until NAV_SETTLE_MS after the answer or the move", () => {
    const moved = { ...start, moved: true, skeleton: true, elsewhere: true };
    expect(navigationDone({ ...moved, idle: false, sinceMoved: 10 })).toBe(false);
    expect(navigationDone({ ...moved, answered: true, sinceAnswered: NAV_SETTLE_MS })).toBe(false);
    expect(navigationDone({ ...moved, answered: true, sinceAnswered: NAV_SETTLE_MS + 1 })).toBe(
      true,
    );
    expect(navigationDone({ ...moved, sinceMoved: NAV_SETTLE_MS + 1 })).toBe(true);
    expect(navigationDone({ ...moved, idle: false, sinceMoved: NAV_SETTLE_MS + 1 })).toBe(false);
  });
});
