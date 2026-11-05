import { describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  steps: [] as [string, ...unknown[]][],
  rows: [] as Record<string, unknown>[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/core/db/server", () => ({
  createServerSupabase: async () => ({
    from() {
      const builder: Record<string, unknown> = {
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: fake.rows, error: null }).then(resolve);
        },
      };
      for (const method of ["select", "in", "eq", "order"]) {
        builder[method] = (...args: unknown[]) => {
          fake.steps.push([method, ...args]);
          return builder;
        };
      }
      return builder;
    },
  }),
}));

import { listAllDefinitionsOf } from "./server";

const row = (id: string, entity: string, position: string) => ({
  id,
  entity,
  client_id: null,
  task_type_id: null,
  key: id,
  label: id,
  help_text: null,
  type: "text",
  options: null,
  required: false,
  section: null,
  position,
  archived_at: null,
});

describe("listAllDefinitionsOf (v2.0 X3: Templates reads the task and project fields at once)", () => {
  it("one read for both entities, each entity's in the read's order, every entity present", async () => {
    fake.rows = [row("t1", "task", "a"), row("p1", "project", "b"), row("t2", "task", "c")];
    const fields = await listAllDefinitionsOf(["task", "project", "client"] as const);
    expect(fake.steps).toContainEqual(["in", "entity", ["task", "project", "client"]]);
    expect(fake.steps).toContainEqual(["order", "position", { ascending: true }]);
    expect(fields.task.map((definition) => definition.id)).toEqual(["t1", "t2"]);
    expect(fields.project.map((definition) => definition.id)).toEqual(["p1"]);
    expect(fields.client).toEqual([]);
  });
});
