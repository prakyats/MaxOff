import { describe, expect, it } from "vitest";

import { REFRESH_MIN_INTERVAL_MS, shouldRefresh } from "./refresh-on-return";

const at = (now: number, lastRefresh = 0, sendWaiting = false) =>
  shouldRefresh({ now, lastRefresh, sendWaiting });

describe("refresh on return (ARCHITECTURE §14.2 i)", () => {
  it("refreshes a return once the last refresh is 30 seconds old", () => {
    expect(at(REFRESH_MIN_INTERVAL_MS)).toBe(true);
    expect(at(5 * 60_000)).toBe(true);
  });

  it("throttles: a return within 30 seconds of the last refresh does nothing", () => {
    expect(at(0)).toBe(false);
    expect(at(REFRESH_MIN_INTERVAL_MS - 1)).toBe(false);
    expect(at(100_000 + 10_000, 100_000)).toBe(false);
  });

  it("never refreshes while an approval is inside its Undo window", () => {
    expect(at(10 * 60_000, 0, true)).toBe(false);
  });
});
