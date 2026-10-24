import { describe, expect, it } from "vitest";

import { ringSegments, segmentTones } from "./segmented-meter";

describe("the segmented meter", () => {
  it("orders the tones: done, next, then the rest, within the total", () => {
    expect(segmentTones({ done: 2, next: 1, total: 5 })).toEqual([
      "done",
      "done",
      "next",
      "rest",
      "rest",
    ]);
    expect(segmentTones({ done: 7, next: 3, total: 4 })).toEqual(["done", "done", "done", "done"]);
    expect(segmentTones({ done: 0, next: 0, total: 0 })).toEqual([]);
  });

  it("lays the ring's segments round a length of 100 with gaps", () => {
    expect(ringSegments(1)).toEqual([{ offset: 0, length: 100 }]);
    const four = ringSegments(4);
    expect(four).toHaveLength(4);
    expect(four[1]?.offset).toBeCloseTo(25.4);
    expect(four.every((segment) => segment.length > 24 && segment.length < 25)).toBe(true);
  });
});
