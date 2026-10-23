import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; steps: [string, ...unknown[]][] };

const fake = vi.hoisted(() => ({
  calls: [] as { table: string; steps: [string, ...unknown[]][] }[],
  answer: { data: null, error: null } as { data: unknown; error: unknown },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/core/activity/server", () => ({ listActivity: vi.fn() }));
vi.mock("@/core/auth/session-bundle", () => ({ getSessionBundle: vi.fn() }));
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

import { getTaskTitle } from "../data/tasks";

const TASK = "0b7c2a52-3f1e-4c3a-9d1e-2f6a8b9c0d11";

/**
 * The task page's tab title (v1.8): Next resolves `generateMetadata` on every prefetch of a task
 * row, so the title is one column of one row under RLS, never the page's reads.
 */
describe("getTaskTitle", () => {
  beforeEach(() => {
    fake.calls.length = 0;
    fake.answer = { data: null, error: null };
  });

  it("reads the title column alone, of that task alone", async () => {
    fake.answer = { data: { title: "Shetty reel" }, error: null };
    expect(await getTaskTitle(TASK)).toBe("Shetty reel");
    expect(fake.calls).toEqual([
      {
        table: "tasks",
        steps: [["select", "title"], ["eq", "id", TASK], ["maybeSingle"]],
      },
    ]);
  });

  it("is null for a task RLS hides, so the tab stays neutral", async () => {
    expect(await getTaskTitle(TASK)).toBeNull();
  });

  it("is null for anything that is not an id, with no read", async () => {
    expect(await getTaskTitle("new")).toBeNull();
    expect(fake.calls).toEqual([]);
  });

  it("throws a failed read rather than naming the tab wrongly", async () => {
    fake.answer = { data: null, error: new Error("down") };
    await expect(getTaskTitle(TASK)).rejects.toThrow("down");
  });
});
