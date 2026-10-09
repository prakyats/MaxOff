import { describe, expect, it } from "vitest";

import {
  LIVE_DASHBOARD_ROUTES,
  LIVE_DASHBOARD_TABLES,
  liveDashboard,
  catchUpRefreshes,
  liveRefreshWaits,
  TOKEN_GRACE_MS,
  TOKEN_RETRY_MS,
  tokenRefreshIn,
} from "./live-rules";

describe("catchUpRefreshes (the first join's catch-up)", () => {
  it("re-reads the screen when the count changed before the channel joined", () => {
    expect(catchUpRefreshes({ count: 0 }, { count: 1 }, false)).toBe(true);
    expect(catchUpRefreshes({ count: 3 }, { count: 2 }, false)).toBe(true);
  });

  it("leaves the screen when nothing changed", () => {
    expect(catchUpRefreshes({ count: 2 }, { count: 2 }, false)).toBe(false);
  });

  it("leaves it while one of this device's reads waits for its count (a read never re-reads)", () => {
    expect(catchUpRefreshes({ count: 2 }, { count: 1 }, true)).toBe(false);
  });

  it("leaves it when the device had no count to compare with", () => {
    expect(catchUpRefreshes(null, { count: 4 }, false)).toBe(false);
  });
});

describe("liveRefreshWaits", () => {
  it("refreshes only when nothing is in the way", () => {
    expect(liveRefreshWaits({ sendWaiting: false, editing: false, navigating: false })).toBe(false);
    expect(liveRefreshWaits({ sendWaiting: true, editing: false, navigating: false })).toBe(true);
    expect(liveRefreshWaits({ sendWaiting: false, editing: true, navigating: false })).toBe(true);
    expect(liveRefreshWaits({ sendWaiting: false, editing: false, navigating: true })).toBe(true);
  });
});

describe("tokenRefreshIn", () => {
  it("asks just after the token expires, by its remaining lifetime", () => {
    expect(tokenRefreshIn(3600)).toBe(3600_000 + TOKEN_GRACE_MS);
  });

  it("a spent token waits the retry, never a tight loop; no expiry, no timer", () => {
    expect(tokenRefreshIn(0)).toBe(TOKEN_RETRY_MS);
    expect(tokenRefreshIn(-600)).toBe(TOKEN_RETRY_MS);
    expect(tokenRefreshIn(1)).toBe(1_000 + TOKEN_GRACE_MS);
    expect(tokenRefreshIn(null)).toBeNull();
  });
});

describe("liveDashboard (the day screens, 6A decision 8; Approvals, kickoff 7 decision 24)", () => {
  it("listens on Today, My Day and Approvals only, by exact path", () => {
    expect(liveDashboard("/today")).toBe(true);
    expect(liveDashboard("/my-day")).toBe(true);
    expect(liveDashboard("/approvals")).toBe(true);
    expect(liveDashboard("/today/people")).toBe(false);
    expect(liveDashboard("/tasks")).toBe(false);
    expect(liveDashboard(null)).toBe(false);
    expect(LIVE_DASHBOARD_ROUTES).toEqual(["/today", "/my-day", "/approvals"]);
  });

  it("listens to exactly the five tables the publication added for them", () => {
    expect([...LIVE_DASHBOARD_TABLES].sort()).toEqual(
      ["attendance_days", "leave_requests", "project_items", "task_assignees", "tasks"].sort(),
    );
  });
});
