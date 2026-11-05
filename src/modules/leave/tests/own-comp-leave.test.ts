import { describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ answer: {} as Record<string, unknown> }));

vi.mock("server-only", () => ({}));
vi.mock("@/core/db/server", () => ({
  createServerSupabase: async () => ({ rpc: async () => ({ data: fake.answer, error: null }) }),
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
});
