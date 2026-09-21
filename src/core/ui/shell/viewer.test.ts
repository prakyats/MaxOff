import { describe, expect, it } from "vitest";

import { initialsOf, isShellRole } from "./viewer";

describe("viewer helpers", () => {
  it("recognises only the three fixed roles", () => {
    expect(isShellRole("ceo")).toBe(true);
    expect(isShellRole("admin")).toBe(true);
    expect(isShellRole("staff")).toBe(true);
    expect(isShellRole("owner")).toBe(false);
    expect(isShellRole(undefined)).toBe(false);
  });

  it("builds initials from the first and last name", () => {
    expect(initialsOf("Prakyat Shetty")).toBe("PS");
    expect(initialsOf("Ananya")).toBe("A");
    expect(initialsOf("  ")).toBe("?");
  });
});
