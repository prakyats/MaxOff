import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A page's first element must have a box (v7.0, bisected to 48527cb3; ARCHITECTURE §14.2 g).
 * Next scrolls a new page to its first element with a box (`layout-router.js`
 * `handlePotentialScroll`): one whose rect is all zeros is skipped for its next sibling, and with
 * none left Next does not scroll at all. A `display: contents` root has no box, so Approvals,
 * wrapped in one, opened where the last tab was left (`motion.spec` "each tab root"). This sweep
 * fails on any `page.tsx` whose returned root element is classed `contents`.
 */
const APP = path.join(import.meta.dirname, "..", "src", "app");

/** The returned root elements of `source` whose class list holds `contents`. */
export function contentsRoots(source: string): string[] {
  const found: string[] = [];
  // `return (` or `return`, then any comments, then the first JSX tag and its attributes.
  const root =
    /return\s*\(?\s*(?:(?:\/\/[^\n]*\n|\{\s*\/\*[\s\S]*?\*\/\s*\}|\/\*[\s\S]*?\*\/)\s*)*<([A-Za-z][\w.]*)\b([^>]*)>/g;
  for (const match of source.matchAll(root)) {
    const attributes = match[2] ?? "";
    const classes = /className=(?:"|\{["`])([^"`]*)/.exec(attributes)?.[1] ?? "";
    if (classes.split(/\s+/).includes("contents")) found.push(match[1] ?? "");
  }
  return found;
}

function pages(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => path.basename(file) === "page.tsx")
    .map((file) => path.join(dir, file));
}

describe("a page's root element has a box (never display: contents)", () => {
  it("finds a contents root, through a comment, and passes a fragment or a boxed root", () => {
    expect(
      contentsRoots(`return (
    // The screen's mark.
    <div data-slot="approvals-page" className="contents">
      <PageHeader />
    </div>
  );`),
    ).toEqual(["div"]);
    expect(contentsRoots(`return <section className="flex contents-x">x</section>;`)).toEqual([]);
    expect(
      contentsRoots(`return (\n    <>\n      <div className="contents" />\n    </>\n  );`),
    ).toEqual([]);
    expect(contentsRoots(`return <div className={"contents"}>x</div>;`)).toEqual(["div"]);
  });

  it.each(pages(APP).map((file) => [path.relative(APP, file), file]))("%s", (_name, file) => {
    expect(contentsRoots(readFileSync(file, "utf8"))).toEqual([]);
  });
});
