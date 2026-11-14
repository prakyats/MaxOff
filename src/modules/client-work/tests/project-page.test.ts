import { describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ answer: null as unknown, calls: [] as unknown[][] }));

vi.mock("server-only", () => ({}));
vi.mock("@/core/db/server", () => ({
  createServerSupabase: async () => ({
    rpc: async (...args: unknown[]) => {
      fake.calls.push(args);
      return { data: fake.answer, error: null };
    },
  }),
}));

import { readProjectPage } from "../data/project-page";

/**
 * The project page's fold (v2.0 X3, `project_page()`; X5+ M5): a project RLS hides (or none)
 * comes back as no project and empty parts, never a throw or a half-mapped row.
 */
describe("readProjectPage", () => {
  it("a hidden project: no project, every part empty", async () => {
    fake.answer = {
      project: null,
      cycles: [],
      stages: [],
      blueprints: [],
      unfinished: [],
      fields: [],
      presets: [],
    };
    expect(await readProjectPage("p-hidden")).toEqual({
      project: null,
      cycles: [],
      stages: [],
      blueprints: [],
      unfinished: [],
      fields: [],
      presetRows: [],
    });
    expect(fake.calls).toEqual([["project_page", { p_project_id: "p-hidden" }]]);
  });
});
