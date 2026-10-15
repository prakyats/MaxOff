import { describe, expect, it } from "vitest";

import { shouldWarm, startWarmUp, WARM_INTERVAL_MS, type WarmUpEnv } from "./warm-up";

/** A browser stand-in whose events the test fires, on a clock the test moves. */
function fakeBrowser() {
  const listeners = new Map<string, Set<() => void>>();
  const target = (prefix: string) => ({
    addEventListener: (type: string, listener: () => void) => {
      const key = `${prefix}:${type}`;
      listeners.set(key, (listeners.get(key) ?? new Set()).add(listener));
    },
    removeEventListener: (type: string, listener: () => void) => {
      listeners.get(`${prefix}:${type}`)?.delete(listener);
    },
  });
  const state = { now: 1_000_000, visibility: "visible", online: true, sent: 0 };
  const env: WarmUpEnv = {
    document: {
      ...target("document"),
      get visibilityState() {
        return state.visibility;
      },
    },
    window: target("window"),
    navigator: {
      get onLine() {
        return state.online;
      },
    },
    now: () => state.now,
    send: () => {
      state.sent += 1;
    },
  };
  const fire = (key: string) => {
    for (const listener of listeners.get(key) ?? []) listener();
  };
  const count = () => [...listeners.values()].reduce((total, set) => total + set.size, 0);
  return { env, state, fire, count };
}

describe("shouldWarm (P2)", () => {
  const at = (now: number, overrides: Partial<{ visible: boolean; online: boolean }> = {}) =>
    shouldWarm({ now, lastWarm: 0, visible: true, online: true, ...overrides });

  it("warms once the last warm-up is 30 seconds old", () => {
    expect(at(WARM_INTERVAL_MS)).toBe(true);
    expect(at(10 * 60_000)).toBe(true);
  });

  it("throttles: never twice within 30 seconds", () => {
    expect(at(0)).toBe(false);
    expect(at(WARM_INTERVAL_MS - 1)).toBe(false);
  });

  it("never while hidden, never offline", () => {
    expect(at(10 * 60_000, { visible: false })).toBe(false);
    expect(at(10 * 60_000, { online: false })).toBe(false);
  });
});

describe("startWarmUp (P2)", () => {
  it("sends nothing at first: the page's own document was the warm-up", () => {
    const browser = fakeBrowser();
    startWarmUp(browser.env, browser.state.now);
    browser.fire("window:focus");
    expect(browser.state.sent).toBe(0);
  });

  it("a return to view after 30 s sends one, and the next within 30 s none", () => {
    const browser = fakeBrowser();
    startWarmUp(browser.env, browser.state.now);
    browser.state.now += 5 * 60_000;
    browser.fire("document:visibilitychange");
    // The focus that comes with the same return is the same moment: no second request.
    browser.fire("window:focus");
    expect(browser.state.sent).toBe(1);
    browser.state.now += WARM_INTERVAL_MS - 1;
    browser.fire("window:focus");
    expect(browser.state.sent).toBe(1);
    browser.state.now += 1;
    browser.fire("window:pageshow");
    expect(browser.state.sent).toBe(2);
  });

  it("going hidden sends nothing (no polling while hidden), nor does a return while offline", () => {
    const browser = fakeBrowser();
    startWarmUp(browser.env, browser.state.now);
    browser.state.now += 5 * 60_000;
    browser.state.visibility = "hidden";
    browser.fire("document:visibilitychange");
    expect(browser.state.sent).toBe(0);
    browser.state.visibility = "visible";
    browser.state.online = false;
    browser.fire("document:visibilitychange");
    expect(browser.state.sent).toBe(0);
    browser.state.online = true;
    browser.fire("document:visibilitychange");
    expect(browser.state.sent).toBe(1);
  });

  it("the cleanup removes every listener", () => {
    const browser = fakeBrowser();
    const stop = startWarmUp(browser.env, browser.state.now);
    expect(browser.count()).toBe(3);
    stop();
    expect(browser.count()).toBe(0);
  });
});
