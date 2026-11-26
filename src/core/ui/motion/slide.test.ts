import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PHONE_QUERY, REDUCED_MOTION_QUERY } from "./nav-types";
import { nameSlide, SLIDE_ABANDON_MS, SLIDE_ATTRIBUTE, slideCommitted } from "./slide";

/**
 * The named slide (`nameSlide`, owner 2026-10-01): the direction a drill-down move is about to
 * make sits on `<html>` from the tap until the slide has run, independent of React's transition
 * types, which a commit during hydration claims and loses (see `slide.ts`).
 */
function fakeBrowser({
  standalone = true,
  reduced = false,
  viewTransitions = true,
  // The route's box against a 800 px screen: by default a long page scrolled 1,000 px down.
  routeBox = { top: -1000, bottom: 3000 },
} = {}) {
  const attributes: Record<string, string> = {};
  const documentElement = {
    setAttribute: (name: string, value: string) => (attributes[name] = value),
    removeAttribute: (name: string) => delete attributes[name],
    hasAttribute: (name: string) => name in attributes,
  };
  // The page's route: its inline clip-path, as the browser would see it at each moment.
  const routeStyle: Record<string, string> = {};
  const route = {
    getBoundingClientRect: () => routeBox,
    style: {
      set clipPath(value: string) {
        routeStyle["clip-path"] = value;
      },
      removeProperty: (name: string) => delete routeStyle[name],
    },
  };
  // Each view transition the page starts: its update and `ready` (both states captured) are
  // resolved by the test.
  const transitions: { updated: () => void; resolve: () => void }[] = [];
  const document = {
    documentElement,
    querySelector: (selector: string) =>
      selector === '#main > [data-slot="route"]' ? route : null,
    ...(viewTransitions
      ? {
          startViewTransition: () => {
            let resolve = () => {};
            let updated = () => {};
            const ready = new Promise<void>((done) => (resolve = done));
            const updateCallbackDone = new Promise<void>((done) => (updated = done));
            transitions.push({ updated, resolve });
            return { ready, updateCallbackDone };
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
    innerHeight: 800,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  });
  return {
    name: () => attributes[SLIDE_ATTRIBUTE],
    /** The page starts a view transition (React's commit); it has captured once `ready` runs. */
    startTransition: () => document.startViewTransition?.(),
    /** The route's clip-path now (`undefined`: none). */
    clip: () => routeStyle["clip-path"],
    /** The transition's update has run (the new page is in; its photograph comes next). */
    updated: async () => {
      transitions[0]?.updated();
      await Promise.resolve();
      await Promise.resolve();
    },
    captured: async () => {
      const transition = transitions.shift();
      transition?.updated();
      transition?.resolve();
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

describe("the page a slide leaves (v7.0, CI 45752942623)", () => {
  it("is clipped to the screen as the transition starts, and unclipped once the update has run", async () => {
    const html = fakeBrowser();
    nameSlide("forward");
    // A page still in use is never clipped: only the transition's start clips it.
    expect(html.clip()).toBeUndefined();
    html.startTransition();
    // Scrolled 1,000 px into a 4,000 px route on an 800 px screen: rows 1,000 to 1,800 are shown.
    expect(html.clip()).toBe("inset(1000px 0 2200px 0)");
    await html.updated();
    // The new page is photographed whole.
    expect(html.clip()).toBeUndefined();
  });

  it("is left alone when it fits on the screen", () => {
    const html = fakeBrowser({ routeBox: { top: 56, bottom: 700 } });
    nameSlide("forward");
    html.startTransition();
    expect(html.clip()).toBeUndefined();
  });

  it("a view transition with no slide named never clips", async () => {
    const html = fakeBrowser();
    nameSlide("forward");
    html.startTransition();
    await html.captured();
    expect(html.clip()).toBeUndefined();
    // A later transition (a view switch, a tab) with nothing named: the page is photographed as is.
    html.startTransition();
    expect(html.clip()).toBeUndefined();
  });
});
