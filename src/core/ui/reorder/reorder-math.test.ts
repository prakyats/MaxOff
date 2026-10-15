import { describe, expect, it } from "vitest";

import {
  dropIndex,
  EDGE_SPEED_MAX,
  edgeScrollStep,
  LONG_PRESS_MS,
  LONG_PRESS_SLOP,
  moveAnnouncement,
  moveItem,
  pressOutcome,
} from "./reorder-math";

describe("moveItem", () => {
  it("moves an entry down and up, as a new array", () => {
    const list = ["a", "b", "c", "d"];
    expect(moveItem(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(list, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(list).toEqual(["a", "b", "c", "d"]);
  });

  it("clamps the target and ignores an index outside the list", () => {
    expect(moveItem(["a", "b", "c"], 0, 9)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, -4)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});

describe("dropIndex", () => {
  it("counts the other rows whose middle is above the pointer", () => {
    const middles = [20, 60, 100];
    expect(dropIndex(middles, 0)).toBe(0);
    expect(dropIndex(middles, 21)).toBe(1);
    expect(dropIndex(middles, 99)).toBe(2);
    expect(dropIndex(middles, 400)).toBe(3);
  });

  it("lands back in place until the pointer passes a neighbour's middle", () => {
    // Rows at 0, 40, 80, 120 (height 40), row 1 dragged: the others' middles are 20, 100, 140.
    expect(dropIndex([20, 100, 140], 70)).toBe(1);
    expect(dropIndex([20, 100, 140], 101)).toBe(2);
  });

  it("feeds moveItem for a whole drag", () => {
    const to = dropIndex([20, 60, 100], 110); // the first row dragged below every other
    expect(moveItem(["a", "b", "c", "d"], 0, to)).toEqual(["b", "c", "d", "a"]);
  });
});

describe("pressOutcome", () => {
  it("drags at once with a mouse or a pen", () => {
    expect(pressOutcome({ pointerType: "mouse", elapsed: 0, distance: 0 })).toBe("drag");
    expect(pressOutcome({ pointerType: "pen", elapsed: 0, distance: 0 })).toBe("drag");
  });

  it("waits for a long press on touch, then drags", () => {
    expect(pressOutcome({ pointerType: "touch", elapsed: 0, distance: 0 })).toBe("wait");
    expect(
      pressOutcome({ pointerType: "touch", elapsed: LONG_PRESS_MS - 1, distance: LONG_PRESS_SLOP }),
    ).toBe("wait");
    expect(pressOutcome({ pointerType: "touch", elapsed: LONG_PRESS_MS, distance: 0 })).toBe(
      "drag",
    );
  });

  it("gives a touch that moves before the long press back (a swipe)", () => {
    expect(
      pressOutcome({ pointerType: "touch", elapsed: 120, distance: LONG_PRESS_SLOP + 1 }),
    ).toBe("cancel");
    expect(pressOutcome({ pointerType: "touch", elapsed: LONG_PRESS_MS + 10, distance: 40 })).toBe(
      "drag",
    );
  });
});

describe("edgeScrollStep", () => {
  it("is still in the middle and scrolls near the edges, faster closer to them", () => {
    expect(edgeScrollStep(300, 0, 600)).toBe(0);
    expect(edgeScrollStep(50, 0, 600)).toBeLessThan(0);
    expect(edgeScrollStep(550, 0, 600)).toBeGreaterThan(0);
    expect(Math.abs(edgeScrollStep(5, 0, 600))).toBeGreaterThan(
      Math.abs(edgeScrollStep(50, 0, 600)),
    );
    expect(edgeScrollStep(-50, 0, 600)).toBe(-EDGE_SPEED_MAX);
    expect(edgeScrollStep(900, 0, 600)).toBe(EDGE_SPEED_MAX);
  });

  it("never scrolls a scroller too short for two edge bands", () => {
    expect(edgeScrollStep(10, 0, 100)).toBe(0);
  });
});

describe("moveAnnouncement", () => {
  it("names the row and its new place, counting from one", () => {
    expect(moveAnnouncement("Phase A", 1, 3)).toBe("Moved Phase A to position 2 of 3.");
  });
});
