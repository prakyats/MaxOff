import { describe, expect, it } from "vitest";

import { liveRefreshWaits, TOKEN_GRACE_MS, TOKEN_RETRY_MS, tokenRefreshIn } from "./live-rules";

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
