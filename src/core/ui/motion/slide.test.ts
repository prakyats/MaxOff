import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PHONE_QUERY, REDUCED_MOTION_QUERY } from "./nav-types";
import { nameSlide, SLIDE_ABANDON_MS, SLIDE_ATTRIBUTE, slideCommitted } from "./slide";

/**
 * The named slide (`nameSlide`, owner 2026-10-01): the direction a drill-down move is about to
 * make sits on `<html>` from the tap until the slide has run, independent of React's transition
 * types, which a commit during hydration claims and loses (see `slide.ts`).
 */
function fakeBrowser({ standalone = true, reduced = false, viewTransitions = true } = {}) {
  const attributes: Record<string, string> = {};
  const documentElement = {
    setAttribute: (name: string, value: string) => (attributes[name] = value),
    removeAttribute: (name: string) => delete attributes[name],
    hasAttribute: (name: string) => name in attributes,
  };
  // Each view transition the page starts: `ready` is resolved by the test (both states captured).
  const transitions: { resolve: () => void }[] = [];
  const document = {
    documentElement,
    ...(viewTransitions
      ? {
          startViewTransition: () => {
            let resolve = () => {};
            const ready = new Promise<void>((done) => (resolve = done));
            transitions.push({ resolve });
            return { ready };
          },
        }
      : {}),
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    matchMedia: (query: string) => ({
      matches:
        (standalone && query === "(display-mode: standalone)") ||
        query === PHONE_QUERY ||
        (reduced && query === REDUCED_MOTION_QUERY),
    }),
    navigator: {},
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  });
  return {
    name: () => attributes[SLIDE_ATTRIBUTE],
    /** The page starts a view transition (React's commit); it has captured once `ready` runs. */
    startTransition: () => document.startViewTransition?.(),
    captured: async () => {
      transitions.shift()?.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("nameSlide", () => {
  it("names the direction at the tap and drops it once the view transition has captured", async () => {
    const html = fakeBrowser();
    nameSlide("back");
    expect(html.name()).toBe("back");
    html.startTransition();
    // Both states are being captured with the name in place.
    expect(html.name()).toBe("back");
    await html.captured();
    expect(html.name()).toBeUndefined();
  });

  it("a view transition right after the slide does not inherit the name", async () => {
    const html = fakeBrowser();
    nameSlide("forward");
    html.startTransition();
    await html.captured();
    // The tab switch that follows starts its own transition, unnamed.
    html.startTransition();
    expect(html.name()).toBeUndefined();
    await html.captured();
    expect(html.name()).toBeUndefined();
  });

  it("drops the name at a commit that started no view transition", () => {
    const html = fakeBrowser();
    nameSlide("back");
    slideCommitted();
    expect(html.name()).toBeUndefined();
  });

  it("drops a name whose screen never came", () => {
    const html = fakeBrowser();
    nameSlide("forward");
    vi.advanceTimersByTime(SLIDE_ABANDON_MS - 1);
    expect(html.name()).toBe("forward");
    vi.advanceTimersByTime(2);
    expect(html.name()).toBeUndefined();
  });

  it("a second tap takes the name over", async () => {
    const html = fakeBrowser();
    nameSlide("back");
    nameSlide("forward");
    expect(html.name()).toBe("forward");
    html.startTransition();
    await html.captured();
    expect(html.name()).toBeUndefined();
  });

  it("names nothing where sliding is not allowed, or without View Transitions", () => {
    const browserTab = fakeBrowser({ standalone: false });
    nameSlide("back");
    expect(browserTab.name()).toBeUndefined();
    const reduced = fakeBrowser({ reduced: true });
    nameSlide("back");
    expect(reduced.name()).toBeUndefined();
    const old = fakeBrowser({ viewTransitions: false });
    nameSlide("back");
    expect(old.name()).toBeUndefined();
  });

  it("a commit with no slide named is nothing to do", () => {
    const html = fakeBrowser();
    expect(() => slideCommitted()).not.toThrow();
    expect(html.name()).toBeUndefined();
  });
});
