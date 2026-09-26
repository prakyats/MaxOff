import { describe, expect, it, vi } from "vitest";

import { isDeadlock, withDeadlockRetry } from "./retry";

const deadlock = { code: "40P01", message: "deadlock detected" };

describe("withDeadlockRetry", () => {
  it("returns the first answer when nothing goes wrong", async () => {
    const run = vi.fn().mockResolvedValue("ok");
    await expect(withDeadlockRetry(run)).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("tries a deadlock victim exactly once more", async () => {
    const run = vi.fn().mockRejectedValueOnce(deadlock).mockResolvedValueOnce("second");
    await expect(withDeadlockRetry(run)).resolves.toBe("second");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("gives up after the second deadlock, with that error", async () => {
    const run = vi.fn().mockRejectedValue(deadlock);
    await expect(withDeadlockRetry(run)).rejects.toBe(deadlock);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("never retries any other error: a CONFLICT is an answer, not a race", async () => {
    const conflict = { code: "P0001", message: "CONFLICT" };
    const run = vi.fn().mockRejectedValue(conflict);
    await expect(withDeadlockRetry(run)).rejects.toBe(conflict);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("recognises only SQLSTATE 40P01", () => {
    expect(isDeadlock(deadlock)).toBe(true);
    expect(isDeadlock({ code: "40001" })).toBe(false);
    expect(isDeadlock(new Error("40P01"))).toBe(false);
    expect(isDeadlock(null)).toBe(false);
  });
});
