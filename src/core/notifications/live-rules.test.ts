import { describe, expect, it } from "vitest";

import { liveRefreshWaits, TOKEN_GRACE_MS, tokenRefreshIn } from "./live-rules";

describe("liveRefreshWaits", () => {
  it("refreshes only when nothing is in the way", () => {
    expect(liveRefreshWaits({ sendWaiting: false, editing: false, navigating: false })).toBe(false);
    expect(liveRefreshWaits({ sendWaiting: true, editing: false, navigating: false })).toBe(true);
    expect(liveRefreshWaits({ sendWaiting: false, editing: true, navigating: false })).toBe(true);
    expect(liveRefreshWaits({ sendWaiting: false, editing: false, navigating: true })).toBe(true);
  });
});

describe("tokenRefreshIn", () => {
  it("asks just after the token expires", () => {
    const now = 1_000_000_000_000;
    expect(tokenRefreshIn(now / 1000 + 3600, now)).toBe(3600_000 + TOKEN_GRACE_MS);
  });

  it("never sooner than the grace, and not at all without an expiry", () => {
    const now = 1_000_000_000_000;
    expect(tokenRefreshIn(now / 1000 - 600, now)).toBe(TOKEN_GRACE_MS);
    expect(tokenRefreshIn(null, now)).toBeNull();
  });
});
