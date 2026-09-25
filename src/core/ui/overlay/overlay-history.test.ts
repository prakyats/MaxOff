import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { type CloseThenEnv, createCloseOverlaysThen, keepMarker } from "./overlay-history";

/**
 * `useOverlayHistory` rests on undocumented behaviour of the Next App Router, and on two race
 * conditions that were found the hard way. Both halves are pinned here: the first against the
 * installed copy of Next, so an upgrade that changes it fails the build instead of quietly
 * turning every back press into a page reload; the second against our own source, so the
 * reasoning behind an unobvious shape cannot be refactored away by accident.
 */
const require_ = createRequire(import.meta.url);
const nextRoot = path.dirname(require_.resolve("next/package.json"));
const nextVersion = (require_("next/package.json") as { version: string }).version;
const appRouter = readFileSync(path.join(nextRoot, "dist/client/components/app-router.js"), "utf8");

describe(`the Next App Router's history contract (next@${nextVersion})`, () => {
  it("copies __NA onto whatever state we push", () => {
    // Why it matters: we push an entry to make back close the overlay. If that entry lacked
    // __NA, Next's own popstate handler would reload the whole page instead of restoring.
    const copy = appRouter.match(/function copyNextJsInternalHistoryState\([\s\S]*?\n}/)?.[0];
    expect(copy, "copyNextJsInternalHistoryState is gone from Next").toBeDefined();
    expect(copy).toContain("__NA");
    expect(copy).toContain("__PRIVATE_NEXTJS_INTERNALS_TREE");
    const patched = appRouter.match(
      /window\.history\.pushState = function pushState[\s\S]*?\n {8}};/,
    )?.[0];
    expect(patched, "Next no longer patches pushState").toBeDefined();
    expect(patched).toContain("copyNextJsInternalHistoryState");
  });

  it("reloads the page for a history entry without __NA", () => {
    // The failure mode the test above protects against: assert it really is the consequence,
    // so the reasoning stays checkable rather than folklore in a comment.
    const onPopState = appRouter.match(/const onPopState = \(event\)=>\{[\s\S]*?\n {8}\};/)?.[0];
    expect(onPopState, "Next's popstate handler moved").toBeDefined();
    expect(onPopState).toContain("!event.state.__NA");
    expect(onPopState).toContain("window.location.reload()");
  });

  it("skips the router dispatch when pushState is called without a url", () => {
    // We push state with no url so the address bar and usePathname never change: opening a
    // sheet is not a navigation. That shortcut holds only while the dispatch stays guarded.
    const patched = appRouter.match(
      /window\.history\.pushState = function pushState[\s\S]*?\n {8}};/,
    )?.[0];
    expect(patched).toMatch(/if \(url\) \{\s*applyUrlFromHistoryPushReplace\(url\);\s*\}/);
  });

  it("rewrites history.state without custom keys after a navigation or a server action", () => {
    // Why the marker is guarded (2.6): HistoryUpdater replaces the current entry's state with a
    // fresh object unless `preserveCustomHistoryState` is set, and the segment-cache navigation
    // (every replace navigation, a refresh after a server action included) sets it to false.
    // If Next ever preserved custom state by default, the guard could go.
    const updater = appRouter.match(/function HistoryUpdater\([\s\S]*?\n}/)?.[0];
    expect(updater, "HistoryUpdater is gone from Next").toBeDefined();
    expect(updater).toContain("pushRef.preserveCustomHistoryState ? window.history.state : {}");
    expect(updater).toContain("window.history.replaceState(historyState, '', canonicalUrl)");
    const navigation = readFileSync(
      path.join(nextRoot, "dist/client/components/segment-cache/navigation.js"),
      "utf8",
    );
    expect(navigation).toContain("preserveCustomHistoryState: false");
  });
});

describe("keepMarker (the marker survives Next's replaceState)", () => {
  it("carries the marker over when the replaced entry has one and the new state does not", () => {
    expect(keepMarker({ __NA: true, maxoffOverlay: 3 }, { __NA: true, tree: [] })).toEqual({
      __NA: true,
      tree: [],
      maxoffOverlay: 3,
    });
    expect(keepMarker({ maxoffOverlay: 3 }, null)).toEqual({ maxoffOverlay: 3 });
    expect(keepMarker({ maxoffOverlay: 3 }, undefined)).toEqual({ maxoffOverlay: 3 });
  });

  it("leaves the new state alone when the entry being replaced is a plain page", () => {
    const next = { __NA: true };
    expect(keepMarker({ __NA: true }, next)).toBe(next);
    expect(keepMarker(null, next)).toBe(next);
    expect(keepMarker(undefined, null)).toBe(null);
  });

  it("keeps a marker the new state already carries, and never wraps a non-object state", () => {
    const next = { maxoffOverlay: 5 };
    expect(keepMarker({ maxoffOverlay: 3 }, next)).toBe(next);
    expect(keepMarker({ maxoffOverlay: 3 }, "opaque")).toBe("opaque");
  });
});

describe("overlay-history wiring", () => {
  const hook = readFileSync(new URL("./overlay-history.ts", import.meta.url), "utf8");

  /** The body of a top-level function, by name — clearer here than a multiline regex. */
  const body = (name: string): string => {
    const from = hook.indexOf(`function ${name}(`);
    return from === -1 ? "" : hook.slice(from, hook.indexOf("\n}", from));
  };

  it("is applied by the primitives, so no overlay can forget it", () => {
    for (const file of ["dialog", "alert-dialog", "sheet"]) {
      const primitive = readFileSync(new URL(`../primitives/${file}.tsx`, import.meta.url), "utf8");
      expect(primitive, file).toContain("useOverlayOpenState");
    }
  });

  it("closes only the topmost overlay on back", () => {
    // Nested case: a confirm dialog over a detail sheet. Back must take one, not both.
    expect(body("onPopState")).toContain("const top = open.pop();");
  });

  it("never pops while reconciling, so a navigation from inside an overlay survives", () => {
    // A link in the More sheet closes the sheet and starts a transition in the same tick. A
    // popstate arriving mid-transition makes Next abandon it, and the tap did nothing at all.
    expect(body("reconcile")).not.toContain("history.back()");
    expect(body("reconcile")).toContain("pushState");
  });

  it("skips a spent entry instead of making a back press look ignored", () => {
    expect(body("onPopState")).toContain("historyState()[MARKER] !== undefined");
    expect(body("onPopState")).toContain("window.history.back()");
  });

  it("reuses a spent entry so open and close cannot pile entries up", () => {
    expect(body("reconcile")).toContain("pushedCount < open.length");
  });

  it("resyncs from where the browser landed, not from a running count", () => {
    expect(body("onPopState")).toContain("pushedCount = open.length;");
    expect(body("onPopState")).toContain("pushedCount = 0;");
  });

  it("preserves the existing history state when pushing", () => {
    expect(hook).toContain("{ ...historyState(),");
  });

  it("guards replaceState so Next's rewrites keep the marker, once per document", () => {
    expect(body("guardMarker")).toContain("keepMarker(this.state, data)");
    expect(body("guardMarker")).toContain("if (history.replaceState[GUARDED]) return;");
    expect(body("startListening")).toContain("guardMarker();");
  });

  it("backs out only an entry it owns, and never on a timer", () => {
    // The 2.6 logout bug: a 300 ms fallback ran the redirect while the back was in flight.
    expect(hook).toContain("pushedCount > 0 && historyState()[MARKER] !== undefined");
    expect(hook).not.toContain("setTimeout");
    expect(hook).not.toContain("FALLBACK");
  });
});

describe("closeOverlaysThen (§14.2 c, e: a tab root or a redirect lands with home underneath)", () => {
  /** A fake browser: the controller owns the top entry or not; a popstate we fire by hand. */
  function setup(ownsTopEntry: boolean) {
    let popListener: (() => void) | null = null;
    const env: CloseThenEnv = {
      ownsTopEntry: () => ownsTopEntry,
      back: vi.fn(),
      onNextPopState: (callback) => {
        popListener = callback;
        return () => {
          popListener = null;
        };
      },
    };
    const fn = vi.fn();
    const closeThen = createCloseOverlaysThen(env);
    const pop = () => popListener?.();
    return { env, fn, closeThen, pop };
  }

  it("runs at once when it owns nothing on top", () => {
    const { env, fn, closeThen } = setup(false);
    expect(closeThen(fn)).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(env.back).not.toHaveBeenCalled();
  });

  it("goes back first and runs on the popstate, once, however long it takes", () => {
    const { env, fn, closeThen, pop } = setup(true);
    closeThen(fn);
    expect(env.back).toHaveBeenCalledTimes(1);
    expect(fn).not.toHaveBeenCalled();
    pop();
    expect(fn).toHaveBeenCalledTimes(1);
    // The listener was one-shot: a second popstate changes nothing.
    pop();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("ignores a second call while the first is under way (a fast double tap)", () => {
    const { env, fn, closeThen, pop } = setup(true);
    const second = vi.fn();
    expect(closeThen(fn)).toBe(true);
    expect(closeThen(second)).toBe(false);
    expect(env.back).toHaveBeenCalledTimes(1);
    pop();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    // Once finished, the next tap is served again.
    expect(closeThen(second)).toBe(true);
  });
});
