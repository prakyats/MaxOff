// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("whenIdle: the after-page parts, one idle moment each (phone-inp (b))", () => {
  let idle: Array<() => void>;

  beforeEach(() => {
    vi.resetModules();
    idle = [];
    window.requestIdleCallback = ((run: () => void) => {
      idle.push(run);
      return idle.length;
    }) as typeof window.requestIdleCallback;
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "requestIdleCallback");
  });

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("runs one job per idle callback, the next only once the previous import has settled", async () => {
    const { whenIdle } = await import("./idle-queue");
    let finishFirst = () => {};
    const ran: string[] = [];
    whenIdle(() => {
      ran.push("live");
      return new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
    });
    whenIdle(() => {
      ran.push("start-day");
    });
    expect(idle).toHaveLength(1);
    idle.shift()?.();
    await flush();
    expect(ran).toEqual(["live"]);
    // The first import is still on its way: the second waits, with no idle callback asked for.
    expect(idle).toHaveLength(0);
    finishFirst();
    await flush();
    expect(idle).toHaveLength(1);
    idle.shift()?.();
    await flush();
    expect(ran).toEqual(["live", "start-day"]);
  });

  it("a cancelled job never runs, and a failed one does not stop the rest", async () => {
    const { whenIdle } = await import("./idle-queue");
    const ran: string[] = [];
    whenIdle(() => Promise.reject(new Error("offline")));
    const stop = whenIdle(() => ran.push("gone"));
    whenIdle(() => ran.push("kept"));
    stop();
    idle.shift()?.();
    await flush();
    idle.shift()?.();
    await flush();
    expect(ran).toEqual(["kept"]);
    expect(idle).toHaveLength(0);
  });
});
