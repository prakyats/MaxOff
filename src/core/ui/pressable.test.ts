import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Every tap is acknowledged within 100 ms (ARCHITECTURE §14.1 and §14.2 i). The pressed state is
 * CSS (`pressable` / `pressable-row` in `globals.css`), so it works before hydration; the shared
 * primitives and composites carry it (`Button`, `buttonVariants`, the menu and select items,
 * `BackLink`, `ViewLink`, `DrillLink`, `OverlayLink`, the bars' items). This sweeps the rest of
 * the source for a clickable element that has none:
 *
 * 1. an intrinsic `<button>` or `<a>`, or a `<Link>`, whose opening tag carries neither
 *    `pressable` (either shape) nor `buttonVariants(`, and is not the child of an `asChild`
 *    component (which merges the parent's classes onto it);
 * 2. any other intrinsic element with an `onClick` (a clickable `div`, `li`, `tr`…).
 *
 * `core/ui/primitives` is where the styles are defined, so it is not swept. An element that is
 * genuinely not a control (a skip link that only takes focus, say) is marked on its line or the
 * one above with `pressable: none` and a reason.
 */

const ESCAPE = "pressable: none";

export type Violation = { line: number; rule: string; text: string };

/** The opening tag that starts at `start` (`<` included), braces and quotes respected. */
function openingTag(text: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + 1; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    // A comment between attributes (`// a bare <button> …`) is skipped to its end.
    if (char === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
      continue;
    }
    if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === ">" && depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

/** Whether the closest enclosing opener before `index` is an `asChild` component. */
function insideAsChild(text: string, index: number): boolean {
  const before = text.slice(0, index).trimEnd();
  if (!before.endsWith(">")) return false;
  const open = before.lastIndexOf("<");
  return open >= 0 && /\basChild\b/.test(openingTag(before, open));
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** A tag named inside a comment (`// a bare <button>`) is prose, not markup. */
function inComment(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const before = text.slice(lineStart, index);
  return before.includes("//") || /^\s*(\*|\/\*|\{\/\*)/.test(before);
}

/** Every clickable element in `text` without the shared pressed state. Exported for fixtures. */
export function findPressableViolations(text: string): Violation[] {
  const lines = text.split("\n");
  const found: Violation[] = [];
  const add = (index: number, rule: string, tag: string) => {
    const line = lineOf(text, index);
    const marked = [line - 1, line - 2].some((n) => (lines[n] ?? "").includes(ESCAPE));
    if (!marked) found.push({ line, rule, text: tag.replace(/\s+/g, " ").slice(0, 120) });
  };
  const styled = (tag: string) => /\bpressable(-row)?\b|buttonVariants\(/.test(tag);

  for (const match of text.matchAll(/<(button|a|Link)(?=[\s>])/g)) {
    if (inComment(text, match.index)) continue;
    const tag = openingTag(text, match.index);
    if (!styled(tag) && !insideAsChild(text, match.index))
      add(match.index, "no-pressed-state", tag);
  }
  for (const match of text.matchAll(/<(div|li|span|tr|td|section|article|img|label)(?=[\s>])/g)) {
    if (inComment(text, match.index)) continue;
    const tag = openingTag(text, match.index);
    if (/\bonClick=/.test(tag) && !styled(tag)) add(match.index, "clickable-element", tag);
  }
  return found;
}

describe("the checker (fixtures)", () => {
  it("flags a raw button, anchor or Link without the pressed state", () => {
    expect(findPressableViolations(`<button type="button" onClick={go}>Go</button>`)).toMatchObject(
      [{ rule: "no-pressed-state", line: 1 }],
    );
    expect(findPressableViolations(`<a href="/x" className="flex">X</a>`)).toMatchObject([
      { rule: "no-pressed-state" },
    ]);
    expect(
      findPressableViolations(`<Link\n  href="/x"\n  className={cn("flex", a > b && "x")}\n/>`),
    ).toMatchObject([{ rule: "no-pressed-state", line: 1 }]);
  });

  it("flags a clickable div", () => {
    expect(findPressableViolations(`<div onClick={open} className="flex" />`)).toMatchObject([
      { rule: "clickable-element" },
    ]);
  });

  it("passes the shared styles, asChild children and marked elements", () => {
    expect(
      findPressableViolations(
        [
          `<button className="pressable flex">A</button>`,
          `<Link href="/x" className={cn(ROW, "pressable-row")}>B</Link>`,
          `<a href="/x" className={buttonVariants({ variant: "secondary" })}>C</a>`,
          `<Button asChild>\n  <Link href="/x">D</Link>\n</Button>`,
          `{/* pressable: none (a skip link: it takes focus, it is never tapped) */}`,
          `<a href="#main">Skip</a>`,
          `<div className="flex">Not clickable</div>`,
          `<abbr title="x">E</abbr>`,
          `// Not a submit: inside a form, a bare <button> submits it.`,
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});

const root = fileURLToPath(new URL("../../../", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(child);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [child] : [];
  });
}

describe("the source", () => {
  const files = sourceFiles(path.join(root, "src"))
    .map((file) => ({
      path: path.relative(root, file).replaceAll("\\", "/"),
      text: readFileSync(file, "utf8"),
    }))
    .filter((file) => !file.path.startsWith("src/core/ui/primitives/"));

  it("finds the source at all, including the bar it guards", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((file) => file.path.endsWith("shell/bottom-nav.tsx"))).toBe(true);
  });

  it("gives every clickable element the shared pressed state", () => {
    const violations = files.flatMap((file) =>
      findPressableViolations(file.text).map((v) => `${file.path}:${v.line} ${v.rule}: ${v.text}`),
    );
    expect(violations).toEqual([]);
  });
});
