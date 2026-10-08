import { describe, expect, it } from "vitest";

import {
  headingElsewhere,
  type NavMoment,
  NAV_SETTLE_MS,
  NAV_TRACK_START,
  navigationDone,
  type NavTrack,
  trackBegin,
  trackCommit,
  trackFetch,
  trackSettle,
} from "./progress";

/** A navigation that has just begun: nothing fetched, nothing moved. */
const start: NavMoment = {
  moved: false,
  skeleton: false,
  track: NAV_TRACK_START,
  unloading: false,
  sinceAnswered: 0,
  sinceMoved: 0,
};

/** The moment with `track` and nothing moved. */
const at = (track: NavTrack, more: Partial<NavMoment> = {}): NavMoment => ({
  ...start,
  track,
  ...more,
});

/** A tap on My Day towards /leave: Next sends the fetch before NavProgress hears the tap. */
const tapped = trackBegin(trackFetch(NAV_TRACK_START, "/leave", "/my-day"), "/my-day");

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

describe("the tracker (what NavProgress has seen of the router's fetches and commits)", () => {
  it("begin keeps the fetches in flight and forgets what the last navigation saw", () => {
    const seen = trackCommit(trackSettle(trackFetch(NAV_TRACK_START, "/a", "/"), "/a", true));
    expect(trackBegin(seen, "/")).toEqual(NAV_TRACK_START);
    expect(tapped).toEqual({ ...NAV_TRACK_START, inFlight: ["/leave"], elsewhere: true });
  });

  it("a settle removes one fetch for its address and keeps a commit already seen", () => {
    const two = trackFetch(trackFetch(NAV_TRACK_START, "/a", "/"), "/a", "/");
    const one = trackSettle(trackCommit(two), "/a", false);
    expect(one.inFlight).toEqual(["/a"]);
    expect(one.committed).toBe(true);
    expect(one.fetched).toBe(true);
  });

  it("a fetch going out forgets the commits before it: a move is pending again", () => {
    const committed = trackCommit(trackSettle(tapped, "/leave", false));
    expect(trackFetch(committed, "/tasks", "/my-day").committed).toBe(false);
  });
});

describe("navigationDone (when the bar and data-nav-pending end, §14.2 i): every path ends", () => {
  it("commit: the move's answered fetch is not the end until the router commits it (CI run 37781084919)", () => {
    const answered = trackSettle(tapped, "/leave", false);
    // The gap dashboards.spec:244 caught: answered, the address not changed yet, no commit.
    expect(navigationDone(at(answered, { sinceAnswered: 40 }))).toBe(false);
    // The router commits the move: the address changes in the same commit.
    expect(navigationDone(at(trackCommit(answered), { moved: true, sinceMoved: 1 }))).toBe(true);
  });

  it("the move on screen: the address changed and no skeleton is left", () => {
    expect(navigationDone({ ...start, moved: true, sinceMoved: 1 })).toBe(true);
  });

  it("a skeleton still in main holds the bar until NAV_SETTLE_MS after the answer or the move", () => {
    const answered = trackSettle(tapped, "/leave", false);
    const moved = { ...start, moved: true, skeleton: true };
    expect(navigationDone({ ...moved, track: tapped, sinceMoved: 10 })).toBe(false);
    expect(navigationDone({ ...moved, track: answered, sinceAnswered: NAV_SETTLE_MS })).toBe(false);
    expect(navigationDone({ ...moved, track: answered, sinceAnswered: NAV_SETTLE_MS + 1 })).toBe(
      true,
    );
    expect(navigationDone({ ...moved, sinceMoved: NAV_SETTLE_MS + 1 })).toBe(true);
    expect(navigationDone({ ...moved, track: tapped, sinceMoved: NAV_SETTLE_MS + 1 })).toBe(false);
  });

  it("same address: the router answers and commits without moving (a redirect back), and the bar ends", () => {
    const answered = trackSettle(tapped, "/leave", false);
    expect(navigationDone(at(trackCommit(answered)))).toBe(true);
  });

  it("view address: a restore the router commits at the address it started from ends the bar", () => {
    // A month move under way, its fetch answered, then the view's own address written by replace
    // (`replaceViewAddress`): Next commits a restore there and the move is dropped.
    const month = trackFetch(
      trackBegin(NAV_TRACK_START, "/calendar"),
      "/calendar?d=11",
      "/calendar",
    );
    const answered = trackSettle(month, "/calendar?d=11", false);
    expect(navigationDone(at(answered))).toBe(false);
    expect(navigationDone(at(trackCommit(answered)))).toBe(true);
  });

  it("error: a fetch that fails ends the bar, unless a page load in full follows it", () => {
    const failed = trackSettle(tapped, "/leave", true);
    expect(navigationDone(at(failed))).toBe(true);
    expect(navigationDone(at(failed, { unloading: true }))).toBe(false);
  });

  it("aborted: an aborted fetch ends the bar once nothing else is in flight", () => {
    const both = trackFetch(tapped, "/tasks", "/my-day");
    const aborted = trackSettle(both, "/leave", true);
    expect(navigationDone(at(aborted))).toBe(false);
    expect(navigationDone(at(trackSettle(aborted, "/tasks", true)))).toBe(true);
  });

  it("superseded by a second tap: the first answer does not end it, the second move does", () => {
    // A second tap before the first answered: its fetch goes out, then the tap is heard.
    const second = trackBegin(trackFetch(tapped, "/tasks", "/my-day"), "/my-day");
    expect(second.inFlight).toEqual(["/leave", "/tasks"]);
    // Next drops the first move: its answer commits nothing.
    const firstAnswered = trackSettle(second, "/leave", false);
    expect(navigationDone(at(firstAnswered))).toBe(false);
    const secondAnswered = trackSettle(firstAnswered, "/tasks", false);
    expect(navigationDone(at(secondAnswered, { sinceAnswered: 40 }))).toBe(false);
    expect(navigationDone(at(trackCommit(secondAnswered), { moved: true, sinceMoved: 1 }))).toBe(
      true,
    );
  });

  it("superseded by a move back to where it started: a commit before the dropped move answers counts", () => {
    // Next month, then Today before it answered: the router drops the month for the address the
    // calendar started from and commits it at once (cached), then the month's fetch answers.
    const month = trackFetch(
      trackBegin(NAV_TRACK_START, "/calendar"),
      "/calendar?d=11",
      "/calendar",
    );
    const back = trackCommit(month);
    expect(navigationDone(at(back))).toBe(false);
    expect(navigationDone(at(trackSettle(back, "/calendar?d=11", false)))).toBe(true);
  });

  it("prefetch-only: no counted fetch, so only the move ends it (a tap that never moves stands down)", () => {
    // A prefetched screen needs no counted fetch: the commit moves the address.
    expect(navigationDone(at(NAV_TRACK_START, { moved: true, sinceMoved: 1 }))).toBe(true);
    // Not moved, nothing fetched: not "done"; NavProgress stands down after IDLE_CANCEL_MS.
    expect(navigationDone(at(trackCommit(NAV_TRACK_START)))).toBe(false);
  });

  it("no-op and refresh: a fetch for the address it started from ends the bar when it answers", () => {
    const refresh = trackFetch(trackBegin(NAV_TRACK_START, "/my-day"), "/my-day", "/my-day");
    expect(navigationDone(at(refresh))).toBe(false);
    expect(navigationDone(at(trackSettle(refresh, "/my-day", false)))).toBe(true);
    expect(navigationDone(start)).toBe(false);
  });
});
