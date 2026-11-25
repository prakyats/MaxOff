import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  SKELETON_NARROW_CHIPS,
  SKELETON_NARROW_TRAILING,
  SKELETON_ROW_GRID,
} from "./list-row-skeleton";

/**
 * The skeleton's copies of `ListRow`'s grid classes (v7.0: the skeleton is a file of its own, so
 * the tap drawings load it without the row) stay the row's own: the source of `list-row.tsx`
 * defines each with the same words.
 */
describe("ListRowSkeleton traces ListRow's grid", () => {
  const source = readFileSync(fileURLToPath(new URL("./list-row.tsx", import.meta.url)), "utf8");
  it.each([
    ["ROW_GRID", SKELETON_ROW_GRID],
    ["NARROW_TRAILING", SKELETON_NARROW_TRAILING],
    ["NARROW_CHIPS", SKELETON_NARROW_CHIPS],
  ])("%s", (name, copy) => {
    const defined = new RegExp(`const ${name} =\\s*"([^"]+)"`).exec(source)?.[1];
    expect(defined).toBe(copy);
  });
});
