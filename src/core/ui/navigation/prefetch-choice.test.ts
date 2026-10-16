import { describe, expect, it } from "vitest";

import { wantsLessData } from "./prefetch-choice";

describe("wantsLessData: data saver", () => {
  it("is on only when the browser says so", () => {
    expect(wantsLessData({ saveData: true })).toBe(true);
    expect(wantsLessData({ saveData: false })).toBe(false);
    expect(wantsLessData({})).toBe(false);
  });

  it("is off without the Network Information API (Safari, Firefox)", () => {
    expect(wantsLessData(undefined)).toBe(false);
    expect(wantsLessData(null)).toBe(false);
  });
});
