import { describe, expect, it } from "vitest";

import { backMove } from "./back-link";

describe("backMove (ARCHITECTURE §14.2 k)", () => {
  it("goes back when an entry of the app is beneath", () => {
    expect(backMove(1)).toBe("back");
    expect(backMove(7)).toBe("back");
  });

  it("goes to the parent when the page was opened directly", () => {
    expect(backMove(0)).toBe("parent");
  });

  it("goes to the parent without the Navigation API: it can never leave the app", () => {
    expect(backMove(undefined)).toBe("parent");
  });
});
