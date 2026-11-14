import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/core/db/server", () => ({
  createServerSupabase: async () => ({
    rpc: async () => ({
      data: {
        task_templates: [],
        task_types: [],
        project_templates: [],
        deliverable_templates: [],
        stage_presets: [],
      },
      error: null,
    }),
  }),
}));

import { readTemplatesLibrary } from "../data/library";

/** Settings → Templates' fold (v2.0 X3, `templates_library()`; X5+ M5): nothing yet, five empty lists. */
describe("readTemplatesLibrary", () => {
  it("an organisation with no templates: each list empty", async () => {
    expect(await readTemplatesLibrary()).toEqual({
      taskTemplates: [],
      taskTypes: [],
      projectTemplates: [],
      deliverableTemplates: [],
      stagePresets: [],
    });
  });
});
