import { describe, expect, it, vi } from "vitest";

import {
  createEarlyReporter,
  EARLY_QUEUE_CAP,
  type ErrorEventTarget,
  type ReporterSdk,
  whenIdleAfterLoad,
} from "./early";

/** A window stand-in whose listeners the test can fire. */
function fakeTarget() {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const target: ErrorEventTarget = {
    addEventListener: (type, listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
  };
  const fire = (type: string, event: object) =>
    listeners.get(type)?.forEach((listener) => listener(event as Event));
  const count = () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
  return { target, fire, count };
}

function fakeSdk() {
  return { captureException: vi.fn(), setUser: vi.fn() } satisfies ReporterSdk;
}

/** A `load` the test resolves by hand, so "before the SDK" is a state it can stay in. */
function deferredLoad(sdk: ReporterSdk) {
  let resolve!: () => void;
  const ready = new Promise<void>((r) => (resolve = r));
  const load = vi.fn(() => ready.then(() => sdk));
  return { load, resolve: async () => (resolve(), await ready, await Promise.resolve()) };
}

const never = () => {};

describe("createEarlyReporter (task 2.8, ARCHITECTURE §18.2)", () => {
  it("queues errors and rejections before the SDK and replays them in order once it loads", async () => {
    const { target, fire } = fakeTarget();
    const sdk = fakeSdk();
    const { load, resolve } = deferredLoad(sdk);
    const reporter = createEarlyReporter(target, load);
    reporter.start(never);

    const boom = new Error("boom during hydration");
    fire("error", { error: boom, message: "Uncaught Error: boom" });
    fire("unhandledrejection", { reason: "rejected" });
    expect(sdk.captureException).not.toHaveBeenCalled();

    await resolve();
    expect(sdk.captureException.mock.calls).toEqual([
      [boom, { mechanism: { type: "onerror", handled: false } }],
      ["rejected", { mechanism: { type: "onunhandledrejection", handled: false } }],
    ]);
  });

  it("loads the SDK at once on the first error, and only once", () => {
    const { target, fire } = fakeTarget();
    const { load } = deferredLoad(fakeSdk());
    createEarlyReporter(target, load).start(never);
    expect(load).not.toHaveBeenCalled();

    fire("error", { error: new Error("a") });
    fire("error", { error: new Error("b") });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("loads when the schedule says so if nothing went wrong", () => {
    const { target } = fakeTarget();
    const { load } = deferredLoad(fakeSdk());
    let scheduled: (() => void) | undefined;
    createEarlyReporter(target, load).start((run) => (scheduled = run));
    expect(load).not.toHaveBeenCalled();
    scheduled!();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("steps aside once the SDK is up: its own handlers take over", async () => {
    const { target, fire, count } = fakeTarget();
    const sdk = fakeSdk();
    const { load, resolve } = deferredLoad(sdk);
    createEarlyReporter(target, load).start(never);
    expect(count()).toBe(2);

    fire("error", { error: new Error("first") });
    await resolve();
    expect(count()).toBe(0);
    fire("error", { error: new Error("after") });
    expect(sdk.captureException).toHaveBeenCalledTimes(1);
  });

  it("keeps at most EARLY_QUEUE_CAP errors", async () => {
    const { target, fire } = fakeTarget();
    const sdk = fakeSdk();
    const { load, resolve } = deferredLoad(sdk);
    createEarlyReporter(target, load).start(never);
    for (let i = 0; i < EARLY_QUEUE_CAP + 5; i++) fire("error", { error: new Error(`${i}`) });
    await resolve();
    expect(sdk.captureException).toHaveBeenCalledTimes(EARLY_QUEUE_CAP);
  });

  it("uses the message when an error event carries no error object", async () => {
    const { target, fire } = fakeTarget();
    const sdk = fakeSdk();
    const { load, resolve } = deferredLoad(sdk);
    createEarlyReporter(target, load).start(never);
    fire("error", { error: null, message: "Script error." });
    await resolve();
    expect(sdk.captureException.mock.calls[0]![0]).toBe("Script error.");
  });

  it("reports boundary errors through the queue before, and straight to the SDK after", async () => {
    const { target } = fakeTarget();
    const sdk = fakeSdk();
    const { load, resolve } = deferredLoad(sdk);
    const reporter = createEarlyReporter(target, load);
    reporter.start(never);

    const early = new Error("caught by a boundary");
    reporter.capture(early);
    expect(load).toHaveBeenCalledTimes(1);
    await resolve();
    expect(sdk.captureException).toHaveBeenCalledWith(early, undefined);

    const late = new Error("later");
    reporter.capture(late);
    expect(sdk.captureException).toHaveBeenLastCalledWith(late);
  });

  it("applies the member id set before the SDK loaded, and forwards later changes", async () => {
    const { target } = fakeTarget();
    const sdk = fakeSdk();
    const { load, resolve } = deferredLoad(sdk);
    const reporter = createEarlyReporter(target, load);
    reporter.start((run) => run());
    reporter.setUser("member-1");
    expect(sdk.setUser).not.toHaveBeenCalled();

    await resolve();
    expect(sdk.setUser).toHaveBeenCalledWith({ id: "member-1" });
    reporter.setUser(null);
    expect(sdk.setUser).toHaveBeenLastCalledWith(null);
  });

  it("tries again at the next error when the SDK chunk failed to load", async () => {
    const { target, fire } = fakeTarget();
    const sdk = fakeSdk();
    const load = vi
      .fn<() => Promise<ReporterSdk>>()
      .mockRejectedValueOnce(new Error("ChunkLoadError"))
      .mockResolvedValueOnce(sdk);
    createEarlyReporter(target, load).start(never);

    fire("error", { error: new Error("one") });
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    fire("error", { error: new Error("two") });
    await vi.waitFor(() => expect(sdk.captureException).toHaveBeenCalledTimes(2));
  });
});

describe("whenIdleAfterLoad", () => {
  function fakeWindow(readyState: string, idle: boolean) {
    const win = {
      document: { readyState },
      addEventListener: vi.fn(),
      setTimeout: vi.fn(),
      ...(idle ? { requestIdleCallback: vi.fn() } : {}),
    };
    return win;
  }

  it("waits for load, then for an idle moment", () => {
    const win = fakeWindow("interactive", true);
    const run = vi.fn();
    whenIdleAfterLoad(win as unknown as Window)(run);
    expect(win.requestIdleCallback).not.toHaveBeenCalled();
    const [event, onLoad] = win.addEventListener.mock.calls[0]!;
    expect(event).toBe("load");
    (onLoad as () => void)();
    expect(win.requestIdleCallback).toHaveBeenCalledWith(run, { timeout: 3000 });
  });

  it("goes straight to idle when the page has already loaded, and falls back without requestIdleCallback", () => {
    const win = fakeWindow("complete", false);
    const run = vi.fn();
    whenIdleAfterLoad(win as unknown as Window)(run);
    expect(win.addEventListener).not.toHaveBeenCalled();
    expect(win.setTimeout).toHaveBeenCalledWith(run, 1000);
  });
});
