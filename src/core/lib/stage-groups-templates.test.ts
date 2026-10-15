import { describe, expect, it } from "vitest";

import { templateMatches } from "./stage-groups";

describe("the template library's search (6b.16 (f))", () => {
  const texts = ["Monthly set", "Item 1", "Item 2", "Other piece"];

  it("matches everything on an empty query", () => {
    expect(templateMatches("", texts)).toBe(true);
    expect(templateMatches("   ", texts)).toBe(true);
  });

  it("finds the name or a deliverable's title, ignoring case", () => {
    expect(templateMatches("monthly", texts)).toBe(true);
    expect(templateMatches("PIECE", texts)).toBe(true);
    expect(templateMatches("weekly", texts)).toBe(false);
  });

  it("needs every word, each anywhere", () => {
    expect(templateMatches("set other", texts)).toBe(true);
    expect(templateMatches("set weekly", texts)).toBe(false);
  });
});
