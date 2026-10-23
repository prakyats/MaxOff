import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { contrastRgb, hexToRgb, readTokens } from "@/core/ui/theme/tint-contrast";

/**
 * The design gate's follow-up (v1.8): today's date is a filled red circle (PP-calendar-1) whose
 * 12–14 px semibold digit must read at AA (4.5:1) in both themes. The dark `brand` red
 * (`#f2686d`) is a light pink that the gate read as failing, so the circle is the solid red of a
 * destructive commit (`destructive-solid`, `#c42126` with white, the same in both themes).
 */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const css = read("../../../app/globals.css");
const SCREENS = ["../components/month-grid.tsx", "../components/calendar-screen.tsx"];

describe("today's red circle on the calendar", () => {
  for (const [theme, selector] of [
    ["light", ":root"],
    ["dark", ".dark"],
  ] as const) {
    it(`${theme}: the white digit on the circle reads at AA`, () => {
      const tokens = readTokens(css, selector);
      const ratio = contrastRgb(
        hexToRgb(tokens["destructive-solid-foreground"] as string),
        hexToRgb(tokens["destructive-solid"] as string),
      );
      expect(ratio, `${theme} today digit = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("every calendar view draws today with the solid red, never the brand red", () => {
    for (const path of SCREENS) {
      const source = read(path);
      expect(source, path).toContain("bg-destructive-solid text-destructive-solid-foreground");
      expect(source, path).not.toContain("bg-brand text-brand-foreground");
    }
  });
});
