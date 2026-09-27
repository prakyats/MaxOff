import { describe, expect, it } from "vitest";

import { DISMISS_DISTANCE, dragIntent, swipeDismisses } from "./swipe-dismiss";

describe("swipe down to close a bottom sheet", () => {
  it("closes past the distance, whatever the speed", () => {
    expect(swipeDismisses(DISMISS_DISTANCE, 2000)).toBe(true);
    expect(swipeDismisses(DISMISS_DISTANCE - 1, 2000)).toBe(false);
  });

  it("closes on a short fast flick, not on a short slow drag", () => {
    expect(swipeDismisses(40, 50)).toBe(true);
    expect(swipeDismisses(40, 400)).toBe(false);
    // Too short to be a flick, however fast.
    expect(swipeDismisses(10, 1)).toBe(false);
  });

  it("starts a drag only downward, and only with the list at its top", () => {
    expect(dragIntent(0, 4, true)).toBe("wait");
    expect(dragIntent(0, 20, true)).toBe("drag");
    expect(dragIntent(0, 20, false)).toBe("none");
    expect(dragIntent(0, -20, true)).toBe("none");
    expect(dragIntent(30, 20, true)).toBe("none");
  });
});
