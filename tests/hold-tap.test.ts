import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `data-hold-tap` is for view controls only (ARCHITECTURE §14.2 l; the advisor on #89,
 * 2026-11-10): the calendar's handle, day boxes, tabs, toggles. A write replayed up to 2 s after
 * the tap would surprise people and skip a confirm sheet not yet drawn. The head script refuses a
 * submit button or one in a form or commit footer (`NEVER_HELD`); this holds the source to the
 * same rule: no marked element is a submit button or a solid commit action (the colour rule's
 * `primary` / `destructive`, ADR-0015).
 */
const ROOT = join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.tsx$/.test(name) ? [path] : [];
  });
}

/** Each JSX opening tag that carries the mark, from its `<` to the `>` that closes it. */
function markedTags(source: string): string[] {
  const tags: string[] = [];
  for (
    let at = source.indexOf("data-hold-tap");
    at >= 0;
    at = source.indexOf("data-hold-tap", at + 1)
  ) {
    const start = source.lastIndexOf("<", at);
    let depth = 0;
    let end = at;
    for (; end < source.length; end++) {
      const ch = source[end];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    tags.push(source.slice(start, end + 1));
  }
  return tags;
}

describe("data-hold-tap marks view controls only", () => {
  const uses = walk(ROOT).flatMap((file) =>
    markedTags(readFileSync(file, "utf8")).map((tag) => ({ file, tag })),
  );

  it("is in use (the guard would prove nothing otherwise)", () => {
    expect(uses.length).toBeGreaterThan(0);
  });

  it("is never on a submit button or a solid commit action", () => {
    const offending = uses.filter(({ tag }) =>
      /type=["{]?["']?submit|variant=["{]?["']?(primary|destructive)/.test(tag),
    );
    expect(offending.map(({ file, tag }) => `${file}: ${tag.slice(0, 80)}`)).toEqual([]);
  });

  it("finds a mark on a commit action (the guard's own check)", () => {
    const tag = markedTags('<Button variant="primary" data-hold-tap="save" type="submit">')[0]!;
    expect(/type=["{]?["']?submit|variant=["{]?["']?(primary|destructive)/.test(tag)).toBe(true);
  });
});
