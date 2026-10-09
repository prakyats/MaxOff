import { describe, expect, it } from "vitest";

import { movedPosition, positionBetween } from "../domain/positions";

describe("positionBetween", () => {
  it("fits a key between two neighbours", () => {
    for (const [a, b] of [
      ["a0", "a1"],
      ["a", "b"],
      ["a0", "b0"],
      ["a0i", "a1"],
      ["0", "z"],
      ["zz", null],
      [null, "a0"],
    ] as const) {
      const key = positionBetween(a, b);
      expect(key).toMatch(/^[0-9a-z]{1,64}$/);
      if (a !== null) expect(key > a).toBe(true);
      if (b !== null) expect(key < b).toBe(true);
    }
  });

  it("starts an empty list in the middle", () => {
    expect(positionBetween(null, null)).toBe("i");
  });

  it("refuses neighbours out of order", () => {
    expect(() => positionBetween("b", "a")).toThrow(RangeError);
  });

  it("keeps fitting keys after many moves to the same place", () => {
    let low = "a0";
    const high = "a1";
    for (let i = 0; i < 40; i += 1) {
      const key = positionBetween(low, high);
      expect(key > low && key < high).toBe(true);
      low = key;
    }
  });
});

describe("movedPosition", () => {
  const rows = [{ position: "a0" }, { position: "a1" }, { position: "a2" }];

  it("moves a row up between its new neighbours", () => {
    const key = movedPosition(rows, 2, "up");
    expect(key !== null && key > "a0" && key < "a1").toBe(true);
    const first = movedPosition(rows, 1, "up");
    expect(first !== null && first < "a0").toBe(true);
  });

  it("moves a row down between its new neighbours", () => {
    const key = movedPosition(rows, 0, "down");
    expect(key !== null && key > "a1" && key < "a2").toBe(true);
    const last = movedPosition(rows, 1, "down");
    expect(last !== null && last > "a2").toBe(true);
  });

  it("does nothing at either end", () => {
    expect(movedPosition(rows, 0, "up")).toBeNull();
    expect(movedPosition(rows, 2, "down")).toBeNull();
  });
});
