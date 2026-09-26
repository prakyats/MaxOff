import { describe, expect, it } from "vitest";

import { slideAllowed } from "./nav-types";

describe("slideAllowed (ARCHITECTURE §14.2 j)", () => {
  it("slides in the installed app at phone width", () => {
    expect(slideAllowed(true, true, false)).toBe(true);
  });

  it("never slides in a browser tab: a website, not an app", () => {
    expect(slideAllowed(false, true, false)).toBe(false);
  });

  it("never slides on the desktop, installed or not", () => {
    expect(slideAllowed(true, false, false)).toBe(false);
    expect(slideAllowed(false, false, false)).toBe(false);
  });

  it("never slides with reduced motion", () => {
    expect(slideAllowed(true, true, true)).toBe(false);
  });
});
