import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { contrastRgb, hexToRgb, over, readTokens } from "@/core/ui/theme/tint-contrast";

import { TASK_TYPE_COLORS } from "../domain/task-types";

/**
 * PP-light-3 (V5b): a task type's calendar chip is its colour at 15% (`typeTint`) over the page,
 * the card or today's box. The title is full foreground and the secondary words (a time, a place)
 * foreground at 80%; both read at AA on every palette colour, in light and dark.
 */
const css = readFileSync(
  fileURLToPath(new URL("../../../app/globals.css", import.meta.url)),
  "utf8",
);

describe("calendar type tints at AA (PP-light-3)", () => {
  for (const [theme, selector] of [
    ["light", ":root"],
    ["dark", ".dark"],
  ] as const) {
    const tokens = readTokens(css, selector);
    it(`${theme}: the title and its secondary words read on every type's tint`, () => {
      const text = hexToRgb(tokens["foreground"] as string);
      for (const surface of ["background", "card", "today"]) {
        const base = hexToRgb(tokens[surface] as string);
        for (const { value, label } of TASK_TYPE_COLORS) {
          const tint = over(hexToRgb(value), 0.15, base);
          expect(
            contrastRgb(text, tint),
            `${theme} ${label} over ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
          const secondary = over(text, 0.8, tint);
          expect(
            contrastRgb(secondary, tint),
            `${theme} 80% text on ${label} over ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }
});
