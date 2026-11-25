import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  error: null as null | { message: string },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/core/db/server", () => ({
  createServerSupabase: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      fake.calls.push({ fn, args });
      return fake.error ? { data: null, error: fake.error } : { data: 7, error: null };
    },
  }),
}));

import { rpcMarkBilled, rpcMarkUnbilled } from "../data/billing";
import { MARK_ALL_MAX, markAllBilledSchema } from "../domain/schemas";

const ids = (n: number) =>
  Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

/**
 * "Mark all N billed" is one transaction (advisor's review of f847ce9): the whole list goes to
 * `billing_mark_unbilled` in ONE call, so a refusal marks nothing instead of leaving earlier batches
 * billed behind an error.
 */
describe("marking billed", () => {
  beforeEach(() => {
    fake.calls = [];
    fake.error = null;
  });

  it("sends a long month's lines in one call, never in batches", async () => {
    const list = ids(450);
    expect(await rpcMarkUnbilled({ cycleIds: list, billedOn: "2026-11-25" })).toBe(7);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.fn).toBe("billing_mark_unbilled");
    expect(fake.calls[0]?.args.cycle_ids).toEqual(list);
  });

  it("a refusal throws once and nothing else is sent", async () => {
    fake.error = { message: "NOT_FOUND" };
    await expect(rpcMarkUnbilled({ cycleIds: ids(450), billedOn: null })).rejects.toEqual({
      message: "NOT_FOUND",
    });
    expect(fake.calls).toHaveLength(1);
  });

  it("one line Billed or Not billed is one call too", async () => {
    await rpcMarkBilled({ cycleId: ids(1)[0]!, billed: true, billedOn: null, note: "Invoice 42" });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.args.cycle_ids).toHaveLength(1);
  });

  it("the screen's cap is the function's (2,000)", () => {
    expect(MARK_ALL_MAX).toBe(2000);
    expect(
      markAllBilledSchema.safeParse({ cycleIds: ids(2000), billedOn: "2026-11-20" }).success,
    ).toBe(true);
    expect(
      markAllBilledSchema.safeParse({ cycleIds: ids(2001), billedOn: "2026-11-20" }).success,
    ).toBe(false);
  });
});
