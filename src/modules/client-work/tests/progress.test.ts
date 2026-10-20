import { describe, expect, it } from "vitest";

import {
  celebratedKey,
  celebrateNow,
  completeWords,
  cycleMeter,
  itemMeter,
  meterLine,
  meterPace,
  percentOf,
  type MeterItem,
} from "../domain/progress";
import type { ItemState } from "../domain/types";
import { orderDeliverables } from "../domain/views";

const TODAY = "2026-10-08";

const ticks = (done: number, total: number) =>
  Array.from({ length: total }, (_, index) => ({ done: index < done }));
const item = (
  state: ItemState,
  done: number,
  total: number,
  plannedDate: string | null = null,
): MeterItem => ({ state, plannedDate, stages: ticks(done, total) });

describe("the cycle's progress indicator (6b.11 (5))", () => {
  it("moves with every tick, not only with deliverables done", () => {
    const before = cycleMeter([item("open", 0, 3), item("open", 0, 3)], TODAY);
    const after = cycleMeter([item("open", 1, 3), item("open", 0, 3)], TODAY);
    expect(before.percent).toBe(0);
    expect(after.percent).toBe(17);
    expect(after.done).toBe(1);
    expect(meterLine(after)).toBe("1 of 6 stages · 0 of 2 deliverables done");
  });

  it("counts a done deliverable whole, leaves closed and carried ones out", () => {
    const meter = cycleMeter(
      [
        item("approved", 1, 4),
        item("done", 0, 2),
        item("open", 2, 4),
        item("cancelled", 0, 5),
        item("carried", 3, 3),
      ],
      TODAY,
    );
    expect(meter.units).toBe(10);
    expect(meter.done).toBe(8);
    expect(meter.next).toBe(1);
    expect(meter.stages).toEqual({ done: 8, total: 10 });
    expect(meter.deliverables).toEqual({ done: 2, total: 3 });
    expect(meter.percent).toBe(80);
    expect(meter.complete).toBe(false);
  });

  it("gives a deliverable without stages one segment", () => {
    const meter = cycleMeter([item("open", 0, 0), item("approved", 0, 0)], TODAY);
    expect(meter.units).toBe(2);
    expect(meter.done).toBe(1);
    expect(meter.next).toBe(0);
    expect(meterLine(meter)).toBe("1 of 2 deliverables done");
  });

  it("never reads 100% before everything is done, nor 0% after a tick", () => {
    expect(percentOf(199, 200)).toBe(99);
    expect(percentOf(1, 300)).toBe(1);
    expect(percentOf(0, 0)).toBe(0);
    expect(percentOf(5, 5)).toBe(100);
  });

  it("counts the open deliverables behind plan; on track otherwise; quiet without dates", () => {
    const behind = cycleMeter(
      [
        item("open", 0, 2, "2026-10-01"),
        item("open", 1, 2, "2026-10-07"),
        item("open", 0, 2, TODAY),
        // Done late is no longer behind.
        item("approved", 2, 2, "2026-10-01"),
      ],
      TODAY,
    );
    expect(behind.behind).toBe(2);
    expect(meterPace(behind)).toEqual({ text: "2 behind plan", tone: "danger" });
    const onTrack = cycleMeter([item("open", 0, 2, "2026-10-09")], TODAY);
    expect(meterPace(onTrack)).toEqual({ text: "On track", tone: "success" });
    expect(meterPace(cycleMeter([item("open", 0, 2)], TODAY))).toBeNull();
  });

  it("is complete only when every counted deliverable is done, and says so", () => {
    const complete = cycleMeter([item("approved", 2, 2), item("cancelled", 0, 1)], TODAY);
    expect(complete.complete).toBe(true);
    expect(complete.percent).toBe(100);
    expect(meterPace(complete)).toBeNull();
    expect(cycleMeter([], TODAY).complete).toBe(false);
    expect(meterLine(cycleMeter([], TODAY))).toBe("No deliverables in this cycle.");
  });

  it("says a cancelled project is cancelled, with its closed deliverables (B8)", () => {
    const closed = { state: "cancelled" as const, plannedDate: null, stages: [] };
    const done = { state: "approved" as const, plannedDate: null, stages: [] };
    const at = "2026-10-21T06:00:00Z";
    expect(meterLine(cycleMeter([closed], TODAY), at)).toBe(
      "Cancelled 21 Oct · 1 deliverable closed",
    );
    expect(meterLine(cycleMeter([closed, closed, done], TODAY), at)).toBe(
      "Cancelled 21 Oct · 2 deliverables closed",
    );
    expect(meterLine(cycleMeter([], TODAY), at)).toBe("Cancelled 21 Oct");
    expect(cycleMeter([closed, done], TODAY).closed).toBe(1);
    expect(completeWords("October 2026")).toBe("October 2026 complete");
    expect(completeWords(null)).toBe("Every deliverable complete");
  });

  it("plays the 100% moment once per cycle per device", () => {
    expect(celebratedKey("c1")).toBe("maxoff.cycle-complete.c1");
    expect(celebrateNow(true, null)).toBe(true);
    expect(celebrateNow(true, "2026-10-08")).toBe(false);
    expect(celebrateNow(false, null)).toBe(false);
  });

  it("draws one deliverable's own stages in miniature", () => {
    expect(itemMeter(item("open", 1, 3))).toEqual({ done: 1, next: 1, total: 3 });
    expect(itemMeter(item("open", 3, 3))).toEqual({ done: 3, next: 0, total: 3 });
    expect(itemMeter(item("approved", 0, 3))).toEqual({ done: 3, next: 0, total: 3 });
    expect(itemMeter(item("cancelled", 1, 3))).toEqual({ done: 1, next: 0, total: 3 });
  });
});

describe("the project page's order (6b.11 (1))", () => {
  const row = (
    id: string,
    state: ItemState,
    plannedDate: string | null,
    overdue = false,
  ): {
    id: string;
    state: ItemState;
    plannedDate: string | null;
    planned: { overdue: boolean } | null;
  } => ({ id, state, plannedDate, planned: plannedDate ? { overdue } : null });

  it("puts open ones first, overdue at the top, then by date; the rest apart in list order", () => {
    const { open, finished } = orderDeliverables([
      row("closed", "cancelled", "2026-10-01"),
      row("undated", "open", null),
      row("later", "open", "2026-10-20"),
      row("late", "open", "2026-10-02", true),
      row("done", "approved", "2026-10-03"),
      row("soon", "open", "2026-10-09"),
      row("carried", "carried", null),
      row("undated 2", "open", null),
    ]);
    expect(open.map((item) => item.id)).toEqual(["late", "soon", "later", "undated", "undated 2"]);
    expect(finished.map((item) => item.id)).toEqual(["closed", "done", "carried"]);
  });
});
