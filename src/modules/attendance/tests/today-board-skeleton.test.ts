import { describe, expect, it } from "vitest";

import { TODAY_STRIP_CELLS } from "../components/today-board-skeleton";
import { TODAY_STRIP_COUNTS } from "../domain/review";

describe("the Owner's attendance strip while Today loads (v7.0)", () => {
  it("draws as many cells as the strip has counts", () => {
    expect(TODAY_STRIP_CELLS).toBe(TODAY_STRIP_COUNTS.length);
  });
});
