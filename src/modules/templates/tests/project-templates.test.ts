import { describe, expect, it } from "vitest";

import { linesOf, projectTemplateActions, type ProjectTemplate } from "../domain/project-templates";

function template(overrides: Partial<ProjectTemplate>): ProjectTemplate {
  return {
    id: "t",
    name: "Monthly retainer",
    description: null,
    recurrence: "monthly",
    stages: ["Script", "Edit"],
    items: ["Reel 1"],
    fieldDefaults: {},
    archived: false,
    createdBy: "admin",
    ...overrides,
  };
}

/**
 * Project templates (7.4; kickoff 7 decision 23, PERMISSIONS ⁴): shared company-wide, an Admin
 * edits and archives the ones they made (own), the Owner any; an archived one is only restored.
 */
describe("project templates", () => {
  it("an Admin edits and archives their own, never another's", () => {
    expect(projectTemplateActions(template({}), { id: "admin", role: "admin" })).toEqual({
      edit: true,
      archive: true,
      restore: false,
    });
    expect(projectTemplateActions(template({}), { id: "other", role: "admin" })).toEqual({
      edit: false,
      archive: false,
      restore: false,
    });
  });

  it("the Owner edits, archives and restores any", () => {
    const owner = { id: "owner", role: "owner" };
    expect(projectTemplateActions(template({}), owner)).toEqual({
      edit: true,
      archive: true,
      restore: false,
    });
    expect(projectTemplateActions(template({ archived: true }), owner)).toEqual({
      edit: false,
      archive: false,
      restore: true,
    });
  });

  it("an archived template is only restored, and only by whoever may", () => {
    expect(
      projectTemplateActions(template({ archived: true }), { id: "admin", role: "admin" }),
    ).toEqual({ edit: false, archive: false, restore: true });
    expect(
      projectTemplateActions(template({ archived: true }), { id: "other", role: "admin" }),
    ).toEqual({ edit: false, archive: false, restore: false });
  });

  it("reads a textarea as one stage or item per line, blanks dropped", () => {
    expect(linesOf("  Script \n\nEdit\n  \nPost")).toEqual(["Script", "Edit", "Post"]);
    expect(linesOf("")).toEqual([]);
  });
});
