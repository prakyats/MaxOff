import { describe, expect, it } from "vitest";

import { createRateLimiter, tooManyRequests } from "./member-rate-limit";

describe("createRateLimiter", () => {
  it("allows the limit within a window, then refuses until the next window", () => {
    const limiter = createRateLimiter({ requests: 3, windowMs: 1000 });
    expect([0, 10, 20].map((at) => limiter.allow("a", at))).toEqual([true, true, true]);
    expect(limiter.allow("a", 30)).toBe(false);
    expect(limiter.allow("a", 999)).toBe(false);
    expect(limiter.allow("a", 1000)).toBe(true);
  });

  it("counts each member on their own", () => {
    const limiter = createRateLimiter({ requests: 1, windowMs: 1000 });
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("a", 1)).toBe(false);
    expect(limiter.allow("b", 2)).toBe(true);
  });

  it("keeps a bounded number of members in memory", () => {
    const limiter = createRateLimiter({ requests: 1, windowMs: 1_000_000 });
    for (let i = 0; i < 600; i++) limiter.allow(`m${i}`, i);
    // The first members' windows were dropped, so they start afresh.
    expect(limiter.allow("m0", 700)).toBe(true);
    // A recent one is still counted.
    expect(limiter.allow("m599", 701)).toBe(false);
  });
});

describe("tooManyRequests", () => {
  it("answers 429, uncached, with when to try again", () => {
    const response = tooManyRequests();
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("retry-after")).toBe("60");
  });
});
