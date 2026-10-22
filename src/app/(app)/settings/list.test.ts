import { describe, expect, it } from "vitest";

import { settingsGroupsFor } from "./list";

const shape = (role: "owner" | "admin") =>
  settingsGroupsFor(role).map((group) => [group.label, group.sections.map((s) => s.label)]);

describe("settingsGroupsFor (PP-admin-9)", () => {
  it("names an Admin's groups by what they hold: Team, then lists, fields and templates", () => {
    expect(shape("admin")).toEqual([
      ["Team", ["Notifications", "Job titles"]],
      ["Lists, fields and templates", ["Custom fields", "Templates"]],
    ]);
  });
  it("folds the Owner's one-section Integrations into its neighbour", () => {
    expect(shape("owner")).toEqual([
      ["Company and working days", ["Company", "Days off & holidays", "Thresholds"]],
      ["Team", ["Notifications", "Job titles"]],
      [
        "Lists, templates and integrations",
        ["Expenses", "Task types", "Custom fields", "Templates", "Google Drive"],
      ],
    ]);
  });
  it("never leaves a group of one", () => {
    for (const role of ["owner", "admin"] as const) {
      for (const group of settingsGroupsFor(role)) expect(group.sections.length).toBeGreaterThan(1);
    }
  });
});
