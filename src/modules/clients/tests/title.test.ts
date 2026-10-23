import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; steps: [string, ...unknown[]][] };

const fake = vi.hoisted(() => ({
  calls: [] as { table: string; steps: [string, ...unknown[]][] }[],
  answer: { data: null, error: null } as { data: unknown; error: unknown },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/core/activity/server", () => ({ listActivity: vi.fn() }));
vi.mock("@/core/db/server", () => ({
  createServerSupabase: async () => ({
    from(table: string) {
      const call: Call = { table, steps: [] };
      fake.calls.push(call);
      const builder: Record<string, unknown> = {
        maybeSingle: async () => {
          call.steps.push(["maybeSingle"]);
          return fake.answer;
        },
      };
      for (const method of ["select", "eq"]) {
        builder[method] = (...args: unknown[]) => {
          call.steps.push([method, ...args]);
          return builder;
        };
      }
      return builder;
    },
  }),
}));

import { getContactName } from "../data/clients";

const CLIENT = "0b7c2a52-3f1e-4c3a-9d1e-2f6a8b9c0d11";
const RECORD = "5d1e7f20-8a4b-4c6d-9e0f-1a2b3c4d5e6f";

/**
 * The contact page's tab title (v1.8): Next resolves `generateMetadata` on every prefetch of it,
 * so the title is one column of one row under RLS, this client's only, never the page's reads.
 */
describe("getContactName", () => {
  beforeEach(() => {
    fake.calls.length = 0;
    fake.answer = { data: null, error: null };
  });

  it("reads the name column alone, of that contact of that client alone", async () => {
    fake.answer = { data: { name: "Asha Rao" }, error: null };
    expect(await getContactName(CLIENT, RECORD)).toBe("Asha Rao");
    expect(fake.calls).toEqual([
      {
        table: "client_contacts",
        steps: [
          ["select", "name"],
          ["eq", "id", RECORD],
          ["eq", "client_id", CLIENT],
          ["maybeSingle"],
        ],
      },
    ]);
  });

  it("is null for a contact RLS hides, or another client's, so the tab stays neutral", async () => {
    expect(await getContactName(CLIENT, RECORD)).toBeNull();
  });

  it("is null for anything that is not an id, with no read", async () => {
    expect(await getContactName(CLIENT, "new")).toBeNull();
    expect(fake.calls).toEqual([]);
  });

  it("throws a failed read rather than naming the tab wrongly", async () => {
    fake.answer = { data: null, error: new Error("down") };
    await expect(getContactName(CLIENT, RECORD)).rejects.toThrow("down");
  });
});
