import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { contrastRgb, hexToRgb, over, readTokens } from "./tint-contrast";

/**
 * PP-light-3 (V5b): every chip and tint in light reads at AA (4.5:1), drawn as the screen draws
 * it: a translucent tint composited over the surface it sits on (the cream page and the white
 * card). The opaque tone chips (`--x` on `--x-soft`) are `status-badge.test.ts`.
 */
const css = readFileSync(
  fileURLToPath(new URL("../../../app/globals.css", import.meta.url)),
  "utf8",
);
const light = readTokens(css, ":root");
const token = (name: string) => {
  const value = light[name];
  if (!value) throw new Error(`--${name} missing in :root`);
  return hexToRgb(value);
};
const SURFACES = ["background", "card"] as const;

describe("light chip tints at AA (PP-light-3)", () => {
  it("the red badge and alert tints (destructive 5–10% behind destructive text)", () => {
    // A red badge that is a link underlines on hover in light rather than deepening its tint: at
    // 20% over the cream page its text fell to 3.9:1 (PP-light-3).
    for (const surface of SURFACES) {
      for (const alpha of [0.05, 0.1]) {
        const tint = over(token("destructive"), alpha, token(surface));
        const ratio = contrastRgb(token("destructive"), tint);
        expect(ratio, `destructive on ${alpha * 100}% over ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("the quiet chips: muted text on the muted fill and on an unread alert row", () => {
    for (const fill of ["muted", "row-unread", "neutral-soft", "sidebar-accent"]) {
      const ratio = contrastRgb(token("muted-foreground"), token(fill));
      expect(ratio, `muted text on ${fill}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the soft tone callouts carry body text too (the attention box on a task)", () => {
    for (const tone of ["attention", "danger", "info", "success", "neutral"]) {
      const ratio = contrastRgb(token("foreground"), token(`${tone}-soft`));
      expect(ratio, `body text on ${tone}-soft`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
