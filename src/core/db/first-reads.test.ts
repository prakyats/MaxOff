import { describe, expect, it, vi } from "vitest";

import { FIRST_READS_WAIT_MS, FirstReads, once } from "./first-reads";

/**
 * The first reads' hold (ARCHITECTURE §19 "Six connections", v1.9 speed gate): a client made
 * while a first-byte read is leaving sends nothing until that read has left, and nothing else
 * ever waits: no hold, a hold that failed, or a hold registered after the wait began.
 */
describe("FirstReads", () => {
  const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  it("waits for nothing when nothing is held", async () => {
    const reads = new FirstReads();
    let done = false;
    void reads.wait().then(() => (done = true));
    await settle();
    expect(done).toBe(true);
  });

  it("holds until every read held so far has left", async () => {
    const reads = new FirstReads();
    let rowLeft: () => void = () => undefined;
    let pushLeft: () => void = () => undefined;
    reads.hold(new Promise<void>((resolve) => (rowLeft = resolve)));
    reads.hold(new Promise<void>((resolve) => (pushLeft = resolve)));
    let done = false;
    void reads.wait().then(() => (done = true));
    await settle();
    expect(done).toBe(false);
    rowLeft();
    await settle();
    expect(done).toBe(false);
    pushLeft();
    await settle();
    expect(done).toBe(true);
  });

  it("holds nothing on a read that failed before it left", async () => {
    const reads = new FirstReads();
    reads.hold(Promise.reject(new Error("no cookie")));
    await expect(reads.wait()).resolves.toBeUndefined();
  });

  it("does not make a wait already begun wait for a read held later", async () => {
    const reads = new FirstReads();
    let done = false;
    void reads.wait().then(() => (done = true));
    reads.hold(new Promise<void>(() => undefined));
    await settle();
    expect(done).toBe(true);
  });

  it("never hangs: a hold that is never released lets the wait go after the limit", async () => {
    vi.useFakeTimers();
    try {
      const reads = new FirstReads();
      reads.hold(new Promise<void>(() => undefined));
      let done = false;
      void reads.wait().then(() => (done = true));
      await vi.advanceTimersByTimeAsync(FIRST_READS_WAIT_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes at once, timer cleared, when the reads leave before the limit", async () => {
    vi.useFakeTimers();
    try {
      const reads = new FirstReads();
      let left: () => void = () => undefined;
      reads.hold(new Promise<void>((resolve) => (left = resolve)));
      const waiting = reads.wait();
      left();
      await waiting;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("once (a left told twice)", () => {
  it("runs the first call and ignores every later one", () => {
    const fn = vi.fn();
    const left = once(fn);
    left();
    left();
    left();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
