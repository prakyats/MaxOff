import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * sonner's toast styles come from its stylesheet, never injected from JS (v4.5, owner decision
 * 25 Nov 2026; `patches/sonner@2.0.8.patch`): the 14.9 KB CSS string stays out of every signed-in
 * route's first load. Fails if a sonner upgrade brings the injection back or the stylesheet goes.
 */
const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve("sonner"));

describe("sonner's CSS: a stylesheet, not injected from JS", () => {
  it.each(["index.js", "index.mjs"])("dist/%s injects no CSS", (file) => {
    const code = readFileSync(path.join(dist, file), "utf8");
    expect(code).not.toContain("__insertCSS");
    expect(code).not.toMatch(/createElement\(['"]style['"]\)/);
    expect(code).not.toContain("[data-sonner-toaster][dir=ltr]");
  });

  it("the stylesheet holds the toast rules, unlayered (they beat Tailwind's layers, as before)", () => {
    const css = readFileSync(path.join(dist, "styles.css"), "utf8");
    expect(css).toContain("[data-sonner-toaster]");
    expect(css).toContain("[data-sonner-toast]");
    expect(css).not.toContain("@layer");
  });

  it("the signed-in layout imports it", () => {
    const layout = readFileSync(
      path.join(process.cwd(), "src/app/(main)/(app)/layout.tsx"),
      "utf8",
    );
    expect(layout).toContain('import "sonner/dist/styles.css";');
  });
});
