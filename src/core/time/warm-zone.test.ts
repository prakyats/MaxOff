import { describe, expect, it } from "vitest";

import { WARM_ZONE_SCRIPT } from "./warm-zone";

/** Runs the head script against a fake window and `Intl`; returns the formatters it built. */
function run(window: Record<string, unknown>) {
  const built: unknown[] = [];
  const intl = {
    DateTimeFormat: function DateTimeFormat(locale: string, options: Intl.DateTimeFormatOptions) {
      built.push([locale, options]);
      return { format: () => "" };
    },
  };
  new Function("window", "Intl", WARM_ZONE_SCRIPT)(window, intl);
  return built;
}

describe("WARM_ZONE_SCRIPT", () => {
  it("makes one IST formatter in an idle moment, never at once", () => {
    const idle: (() => void)[] = [];
    const built = run({ requestIdleCallback: (fn: () => void) => idle.push(fn) });
    expect(built).toEqual([]);
    expect(idle).toHaveLength(1);
    idle[0]!();
    expect(built).toEqual([["en-GB", { hour: "numeric", timeZone: "Asia/Kolkata" }]]);
  });

  it("without idle callbacks (Safari): after the first frame, then a task", () => {
    const frames: (() => void)[] = [];
    const tasks: (() => void)[] = [];
    const built = run({
      requestAnimationFrame: (fn: () => void) => frames.push(fn),
      setTimeout: (fn: () => void) => tasks.push(fn),
    });
    expect(built).toEqual([]);
    frames[0]!();
    expect(built).toEqual([]);
    tasks[0]!();
    expect(built).toHaveLength(1);
  });

  it("never throws, even where nothing can be scheduled", () => {
    expect(() => run({})).not.toThrow();
  });
});
