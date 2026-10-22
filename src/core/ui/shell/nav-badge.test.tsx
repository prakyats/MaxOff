import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NavBadgeMark } from "./nav-badge";

/** The laptop top bar's bell count (V5b major change 9). */
describe("NavBadgeMark on the top bar's bell", () => {
  it("is nothing at zero and caps at 99+", () => {
    expect(renderToStaticMarkup(<NavBadgeMark count={0} place="topbar" />)).toBe("");
    expect(renderToStaticMarkup(<NavBadgeMark count={7} place="topbar" />)).toContain(">7<");
    expect(renderToStaticMarkup(<NavBadgeMark count={250} place="topbar" />)).toContain(">99+<");
  });

  it("is a pill offset top-right outside the glyph, ringed in the bar's background", () => {
    const out = renderToStaticMarkup(<NavBadgeMark count={3} place="topbar" />);
    for (const token of [
      "absolute",
      "-top-1.5",
      "left-4",
      "ring-2",
      "ring-background",
      "rounded-full",
    ]) {
      expect(out).toContain(token);
    }
  });
});
