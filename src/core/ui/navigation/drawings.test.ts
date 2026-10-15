import { describe, expect, it } from "vitest";

import { drawingShownAgain } from "./drawings";

describe("a drawing shown again (FreshOnReturn, 6b.12)", () => {
  it("is fresh on its first mount and shown again on every later one", () => {
    expect(drawingShownAgain("render-a")).toBe(false);
    expect(drawingShownAgain("render-a")).toBe(true);
    expect(drawingShownAgain("render-a")).toBe(true);
  });

  it("a new server render is a new drawing: fresh, so a refresh never loops", () => {
    expect(drawingShownAgain("render-b")).toBe(false);
    expect(drawingShownAgain("render-c")).toBe(false);
  });
});
