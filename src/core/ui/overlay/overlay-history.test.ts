import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

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
});
