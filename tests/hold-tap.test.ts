import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `data-hold-tap` is for view controls only (ARCHITECTURE §14.2 l; the advisor on #89,
 * 2026-11-10): the calendar's handle, day boxes, tabs, toggles. A write replayed up to 2 s after
 * the tap would surprise people and skip a confirm sheet not yet drawn. The head script refuses a
 * submit button or one in a form or commit footer (`NEVER_HELD`); this holds the source to the
 * same rule: no marked element is a submit button or a solid commit action (the colour rule's
 * `primary`, `danger`, `approve`, or the `destructive` prop; ADR-0015). Batch 5 M3 widened it.
 */
const ROOT = join(process.cwd(), "src");

/**
 * A commit, in a marked element's opening tag: a submit; a solid variant (`primary`, `danger`,
 * `approve`: the colour rule's commits, `button-variants.ts`); or a destructive submit (the
 * `destructive` prop).
 */
const COMMIT =
  /type=["{]?["']?submit|variant=["{]?["']?(primary|danger|approve)\b|\sdestructive(?=[\s=/>])/;

/** The mark, written out or spread through its constant (`{...{ [HOLD_TAP_ATTRIBUTE]: … }}`). */
const MARK = /data-hold-tap|HOLD_TAP_ATTRIBUTE/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.tsx$/.test(name) ? [path] : [];
  });
}

/** Each JSX opening tag that carries the mark, from its `<` to the `>` that closes it. */
function markedTags(source: string): string[] {
  const tags: string[] = [];
  for (const match of source.matchAll(MARK)) {
    const at = match.index;
    // Inside a tag: the nearest `<` before it opens the element that carries the mark.
    // An attribute (`data-hold-tap=`) or a spread key (`[HOLD_TAP_ATTRIBUTE]`): never an import.
    const isMark =
      match[0] === "data-hold-tap" ? source[at + match[0].length] === "=" : source[at - 1] === "[";
    if (!isMark || source.lastIndexOf("<", at) < 0) continue;
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
    const offending = uses.filter(({ tag }) => COMMIT.test(tag));
    expect(offending.map(({ file, tag }) => `${file}: ${tag.slice(0, 80)}`)).toEqual([]);
  });

  it("finds a mark on a commit action, written out or spread (the guard's own check)", () => {
    for (const source of [
      '<Button variant="primary" data-hold-tap="save">',
      '<Button variant="danger" data-hold-tap="delete">',
      '<Button variant="approve" data-hold-tap="approve">',
      '<Button destructive data-hold-tap="cancel">',
      '<button type="submit" data-hold-tap="send">',
      '<Button {...{ [HOLD_TAP_ATTRIBUTE]: "save" }} variant="primary">',
    ]) {
      const [tag] = markedTags(source);
      expect(tag, source).toBeDefined();
      expect(COMMIT.test(tag!), source).toBe(true);
    }
  });

  it("leaves a view control alone, and an import of the mark is not a tag", () => {
    const source =
      'import { HOLD_TAP_ATTRIBUTE } from "x";\n<button type="button" data-hold-tap="day">';
    const tags = markedTags(source);
    expect(tags).toHaveLength(1);
    expect(COMMIT.test(tags[0]!)).toBe(false);
  });
});
