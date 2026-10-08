import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; steps: [string, ...unknown[]][] };

const fake = vi.hoisted(() => ({
  calls: [] as { table: string; steps: [string, ...unknown[]][] }[],
  rows: (() => []) as (call: { table: string; steps: [string, ...unknown[]][] }) => unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/core/activity/server", () => ({ listActivity: vi.fn() }));
vi.mock("@/core/db/server", () => ({
  createServerSupabase: async () => ({
    from(table: string) {
      const call: Call = { table, steps: [] };
      fake.calls.push(call);
      const builder: Record<string, unknown> = {
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve({ data: fake.rows(call), error: null }).then(resolve, reject);
        },
      };
      for (const method of ["select", "in", "eq", "or", "order", "range", "lte", "gte", "lt"]) {
        builder[method] = (...args: unknown[]) => {
          call.steps.push([method, ...args]);
          return builder;
        };
      }
      return builder;
    },
  }),
}));

import { listSentBack } from "../data/items";
import { chunks, IDS_PER_READ, listItemsById, listReviews } from "../data/projects";

const ids = (n: number, prefix = "i") =>
  Array.from({ length: n }, (_, k) => `${prefix}${String(k).padStart(4, "0")}`);

function inFilters(call: Call): unknown[] {
  return call.steps.filter(([method]) => method === "in").map(([, , values]) => values);
}

function itemRow(id: string) {
  return {
    id,
    project_id: "p",
    cycle_id: "c",
    title: id,
    position: "a",
    planned_date: null,
    notes: null,
    custom_fields: {},
    state: "open",
    done_at: null,
    done_by: null,
    approved_at: null,
    approved_by: null,
    cancelled_reason: null,
    carry_decision: null,
    carried_from_item_id: null,
    origin_cycle_id: null,
    created_at: "2026-10-01T00:00:00Z",
    project: {
      name: "Reels",
      client_id: "k",
      client: { name: "Acme", admin_id: "a", state: "active" },
    },
    cycle: { label: "October 2026", period_end: "2026-10-31" },
  };
}

/**
 * The client-work reads keyed by id lists (the 7B review's M1): every list goes out in chunks of
 * `IDS_PER_READ` ids, so no address outgrows the proxy however many ids a screen holds, and the
 * answers come back joined.
 */
describe("the chunked id reads", () => {
  beforeEach(() => {
    fake.calls.length = 0;
    fake.rows = () => [];
  });

  it("chunks splits a list into IDS_PER_READ-sized parts", () => {
    expect(chunks([])).toEqual([]);
    expect(chunks(ids(IDS_PER_READ)).map((part) => part.length)).toEqual([IDS_PER_READ]);
    expect(chunks(ids(2 * IDS_PER_READ + 20)).map((part) => part.length)).toEqual([
      IDS_PER_READ,
      IDS_PER_READ,
      20,
    ]);
  });

  it("items by id: one request per chunk, every row back, nothing read for no ids", async () => {
    expect(await listItemsById([])).toEqual([]);
    expect(fake.calls).toHaveLength(0);

    const wanted = ids(2 * IDS_PER_READ + 20);
    fake.rows = (call) => (inFilters(call)[0] as string[]).map(itemRow);
    const items = await listItemsById(wanted);
    expect(fake.calls.map((call) => (inFilters(call)[0] as string[]).length)).toEqual([
      IDS_PER_READ,
      IDS_PER_READ,
      20,
    ]);
    expect(items.map((item) => item.id)).toEqual(wanted);
  });

  it("reviews: chunked, and newest first across the chunks", async () => {
    const wanted = ids(IDS_PER_READ + 1);
    fake.rows = (call) => {
      const part = inFilters(call)[0] as string[];
      // The second chunk holds the newest review.
      return part.map((id) => ({
        item_id: id,
        decision: "rejected",
        reason: null,
        reviewer_id: "r",
        at: part.length === 1 ? "2026-10-08T10:00:00Z" : "2026-10-01T10:00:00Z",
      }));
    };
    const reviews = await listReviews(wanted);
    expect(fake.calls).toHaveLength(2);
    expect(reviews).toHaveLength(IDS_PER_READ + 1);
    expect(reviews[0]?.itemId).toBe(wanted[IDS_PER_READ]);
  });

  it("sent back: only rejections are read, the latest per item, never the viewer's own", async () => {
    const many = ids(IDS_PER_READ + 5, "s");
    fake.rows = (call) => {
      if (call.table === "item_reviews") {
        return [
          { item_id: "mine", reason: "x", reviewer_id: "viewer", at: "2026-10-08T09:00:00Z" },
          { item_id: "s0000", reason: "newest", reviewer_id: "owner", at: "2026-10-08T08:00:00Z" },
          ...many.map((id) => ({
            item_id: id,
            reason: "older",
            reviewer_id: "owner",
            at: "2026-10-01T08:00:00Z",
          })),
        ];
      }
      return (inFilters(call)[0] as string[]).map(itemRow);
    };
    const rows = await listSentBack("viewer");
    const reviewCall = fake.calls.find((call) => call.table === "item_reviews");
    expect(reviewCall?.steps).toContainEqual(["eq", "decision", "rejected"]);
    expect(reviewCall?.steps).toContainEqual(["eq", "item.state", "open"]);
    const itemCalls = fake.calls.filter((call) => call.table === "project_items");
    expect(itemCalls.map((call) => (inFilters(call)[0] as string[]).length)).toEqual([
      IDS_PER_READ,
      5,
    ]);
    expect(rows).toHaveLength(IDS_PER_READ + 5);
    expect(rows.find((row) => row.id === "s0000")?.reason).toBe("newest");
    expect(rows.some((row) => row.id === "mine")).toBe(false);
  });
});
