import { describe, expect, it, vi } from "vitest";

import { whenWaiting } from "./when-waiting";

describe("whenWaiting: a list read only when its count says one is waiting", () => {
  it("reads the list when the count is above 0", async () => {
    const read = vi.fn(async () => ["row"]);
    await expect(whenWaiting(Promise.resolve({ n: 2 }), (c) => c.n, read)).resolves.toEqual([
      "row",
    ]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("makes no read for a count of 0 or null (not this viewer's to decide)", async () => {
    const read = vi.fn(async () => ["row"]);
    await expect(whenWaiting(Promise.resolve({ n: 0 }), (c) => c.n, read)).resolves.toEqual([]);
    await expect(
      whenWaiting(Promise.resolve({ n: null as number | null }), (c) => c.n, read),
    ).resolves.toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  it("asks the usual way when the counts cannot be read", async () => {
    const read = vi.fn(async () => ["row"]);
    await expect(
      whenWaiting(Promise.reject(new Error("bundle down")), (c: { n: number }) => c.n, read),
    ).resolves.toEqual(["row"]);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
