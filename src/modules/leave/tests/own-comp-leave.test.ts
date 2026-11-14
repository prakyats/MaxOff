import { describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  answer: {} as Record<string, unknown>,
  // Per function: what `rpc(name)` answers when set (the fold's own answer otherwise).
  rpcs: {} as Record<string, { data: unknown; error: unknown }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/core/db/server", () => ({
  createServerSupabase: async () => ({
    rpc: async (name: string) => fake.rpcs[name] ?? { data: fake.answer, error: null },
  }),
}));

import { readOwnCompLeave } from "../data/credits";

describe("readOwnCompLeave (v2.0 X3: the balance and the dates in one read)", () => {
  it("maps the balance as getCompBalance did and the dates as listCompDates did", async () => {
    fake.answer = {
      balance: { available_days: "1.5", use_by: "2026-12-01" },
      balance_refused: null,
      dates: [{ work_date: "2026-11-09", available_days: "1.5" }],
      dates_refused: null,
    };
    expect(await readOwnCompLeave()).toEqual({
      balance: { availableDays: 1.5, useBy: "2026-12-01" },
      dates: [{ date: "2026-11-09", availableDays: 1.5 }],
    });
  });

  it("refused dates: undefined, as the layout took a failed listCompDates", async () => {
    fake.answer = {
      balance: { available_days: 0, use_by: null },
      balance_refused: null,
      dates: null,
      dates_refused: "FORBIDDEN",
    };
    expect((await readOwnCompLeave()).dates).toBeUndefined();
  });

  it("a refused balance throws the code comp_leave_balance refused with, as the read did", async () => {
    fake.answer = {
      balance: null,
      balance_refused: "UNAUTHENTICATED",
      dates: null,
      dates_refused: "UNAUTHENTICATED",
    };
    await expect(readOwnCompLeave()).rejects.toThrow("UNAUTHENTICATED");
  });

  it("a failed fold falls back to the two reads it replaced: the balance is never lost (X6 review)", async () => {
    fake.rpcs = {
      own_comp_leave: { data: null, error: new Error("could not compute the dates") },
      comp_leave_balance: { data: [{ available_days: "2", use_by: "2026-12-10" }], error: null },
      comp_leave_dates: { data: [{ work_date: "2026-11-12", available_days: "2" }], error: null },
    };
    expect(await readOwnCompLeave()).toEqual({
      balance: { availableDays: 2, useBy: "2026-12-10" },
      dates: [{ date: "2026-11-12", availableDays: 2 }],
    });
    fake.rpcs.comp_leave_dates = { data: null, error: new Error("still failing") };
    expect(await readOwnCompLeave()).toEqual({
      balance: { availableDays: 2, useBy: "2026-12-10" },
      dates: undefined,
    });
    fake.rpcs = {};
  });
});
