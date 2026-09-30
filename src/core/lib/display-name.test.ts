import { describe, expect, it } from "vitest";

import { displayName } from "./display-name";

describe("displayName (Kickoff 4 decision 30)", () => {
  it("is the full name, never a first name", () => {
    expect(displayName("Ravi Kumar")).toBe("Ravi Kumar");
    expect(displayName("Prishit Shetty")).toBe("Prishit Shetty");
    expect(displayName("Test Task Staff (desktop)")).toBe("Test Task Staff (desktop)");
  });

  it("tidies the spaces and nothing else", () => {
    expect(displayName("  Asha   R  Nair ")).toBe("Asha R Nair");
    expect(displayName("Asha\tNair")).toBe("Asha Nair");
  });

  it("names nobody in particular when the name is missing", () => {
    expect(displayName(null)).toBe("Someone");
    expect(displayName(undefined)).toBe("Someone");
    expect(displayName("   ")).toBe("Someone");
    expect(displayName("", "The Owner")).toBe("The Owner");
  });
});
