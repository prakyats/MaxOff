import { describe, expect, it } from "vitest";

import {
  allocateCycle,
  amountInMonth,
  cyclePotential,
  oneTimeMonth,
  type AllocationItem,
} from "../domain/allocation";

// The same cases as pgTAP 144 (supabase/tests/144_money_tables.test.sql, sections 2 and 3).
const plan = (
  id: string,
  position: string,
  extra: Partial<AllocationItem> = {},
): AllocationItem => ({
  id,
  position,
  added: false,
  explicitValue: null,
  inPotential: true,
  ...extra,
});
const added = (id: string, position: string, explicitValue: number | null): AllocationItem => ({
  id,
  position,
  added: true,
  explicitValue,
  inPotential: true,
});
const values = (amount: number | null, items: AllocationItem[]) =>
  Object.fromEntries(
    allocateCycle(amount, items).map((item) => [item.id, [item.method, item.value]]),
  );

describe("allocateCycle", () => {
  it("splits to the paisa, the leftover on the first by position", () => {
    expect(values(10000, [plan("i3", "c"), plan("i1", "a"), plan("i2", "b")])).toEqual({
      i1: ["split", 3333.34],
      i2: ["split", 3333.33],
      i3: ["split", 3333.33],
    });
  });

  it("keeps added work out of the split: nothing until priced, then on top", () => {
    const items = [plan("i1", "a"), plan("i2", "b"), plan("i3", "c"), added("xa", "d", null)];
    const before = allocateCycle(10000, items);
    expect(before.find((item) => item.id === "xa")).toEqual({
      id: "xa",
      method: "not_priced",
      value: 0,
    });
    expect(cyclePotential(before)).toBe(10000);

    const after = allocateCycle(10000, [
      ...items.slice(0, 3),
      added("xa", "d", 2718),
      added("xb", "e", 0),
    ]);
    expect(after.find((item) => item.id === "i1")?.value).toBe(3333.34);
    expect(after.find((item) => item.id === "xb")).toEqual({ id: "xb", method: "added", value: 0 });
    expect(cyclePotential(after)).toBe(12718);
  });

  it("takes explicit plan values off the top", () => {
    expect(
      values(10000, [plan("i1", "a"), plan("i2", "b", { explicitValue: 4000 }), plan("i3", "c")]),
    ).toEqual({
      i1: ["split", 3000],
      i2: ["explicit", 4000],
      i3: ["split", 3000],
    });
  });

  it('leaves a "Not needed" deliverable out and splits over the rest', () => {
    expect(
      values(10000, [plan("i1", "a"), plan("i2", "b"), plan("i3", "c", { inPotential: false })]),
    ).toEqual({
      i1: ["split", 5000],
      i2: ["split", 5000],
      i3: ["excluded", 0],
    });
  });

  it("values nothing without an amount, but keeps explicit and added prices", () => {
    expect(
      values(null, [
        plan("i1", "a"),
        plan("i2", "b", { explicitValue: 100 }),
        added("xa", "c", 50),
      ]),
    ).toEqual({
      i1: ["no_amount", 0],
      i2: ["explicit", 100],
      xa: ["added", 50],
    });
  });

  it("always adds up to the amount", () => {
    for (const [amount, count] of [
      [100, 3],
      [1, 7],
      [99999, 13],
      [0, 4],
    ] as const) {
      const items = Array.from({ length: count }, (_, index) =>
        plan(`i${index}`, String(index).padStart(2, "0")),
      );
      expect(cyclePotential(allocateCycle(amount, items))).toBe(amount);
    }
  });

  it("never goes negative when explicit values pass the amount", () => {
    expect(values(100, [plan("i1", "a", { explicitValue: 150 }), plan("i2", "b")])).toEqual({
      i1: ["explicit", 150],
      i2: ["split", 0],
    });
  });
});

describe("oneTimeMonth", () => {
  const base = {
    deliveryDate: "2026-12-10",
    completedOn: null,
    cancelledOn: null,
    today: "2026-11-18",
  };

  it("sits in its delivery month while not due", () => {
    expect(oneTimeMonth({ ...base, state: "open" })).toEqual({
      month: "2026-12-01",
      wasDue: false,
    });
  });
  it("moves to the current month while overdue", () => {
    expect(oneTimeMonth({ ...base, state: "in_progress", deliveryDate: "2026-10-10" })).toEqual({
      month: "2026-11-01",
      wasDue: true,
    });
  });
  it("is due but still in this month when the date passed this month", () => {
    expect(oneTimeMonth({ ...base, state: "open", deliveryDate: "2026-11-10" })).toEqual({
      month: "2026-11-01",
      wasDue: true,
    });
  });
  it("sits in the completion month once completed, early or late", () => {
    expect(oneTimeMonth({ ...base, state: "completed", completedOn: "2026-11-18" }).month).toBe(
      "2026-11-01",
    );
    expect(
      oneTimeMonth({
        ...base,
        state: "completed",
        deliveryDate: "2026-09-01",
        completedOn: "2026-10-03",
      }).month,
    ).toBe("2026-10-01");
  });
  it("sits in the cancellation month once cancelled", () => {
    expect(oneTimeMonth({ ...base, state: "cancelled", cancelledOn: "2026-11-02" }).month).toBe(
      "2026-11-01",
    );
  });
});

describe("amountInMonth", () => {
  it('reads "No amount set" before the first priced month', () => {
    expect(amountInMonth(7000, "2026-11-01", "2026-10-01")).toBeNull();
    expect(amountInMonth(7000, "2026-11-01", "2026-11-01")).toBe(7000);
    expect(amountInMonth(7000, null, "2026-11-01")).toBeNull();
    expect(amountInMonth(0, "2026-11-01", "2026-12-01")).toBe(0);
  });
});
