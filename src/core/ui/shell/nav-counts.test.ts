import { describe, expect, it, vi } from "vitest";

import { badgeTotal } from "./nav";
import { countsOrNone, NO_BADGES } from "./nav-counts";

describe("countsOrNone", () => {
  it("passes the counts through when they are read", async () => {
    const report = vi.fn();
    const counts = await countsOrNone(Promise.resolve({ tasks: 2, approvals: 3 }), report);
    expect(counts).toEqual({ tasks: 2, approvals: 3 });
    expect(report).not.toHaveBeenCalled();
  });

  it("reports a failed read once and shows no counts instead of failing the shell (4C review S3)", async () => {
    const report = vi.fn();
    const failure = new Error("task_counts: permission denied");
    const counts = await countsOrNone(Promise.reject(failure), report);
    expect(counts).toBe(NO_BADGES);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(failure);
    expect(badgeTotal(counts, ["tasks", "approvals"])).toBe(0);
  });

  it("still fails when the reporter rethrows (a framework signal, not a read error)", async () => {
    const signal = new Error("NEXT_REDIRECT");
    const rethrow = (error: unknown) => {
      throw error;
    };
    await expect(countsOrNone(Promise.reject(signal), rethrow)).rejects.toBe(signal);
  });
});
