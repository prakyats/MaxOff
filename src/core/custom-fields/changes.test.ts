import { describe, expect, it } from "vitest";

import { customFieldChanges } from "./changes";
import type { FieldDefinition } from "./registry";

function definition(overrides: Partial<FieldDefinition>): FieldDefinition {
  return {
    id: overrides.key ?? "id",
    entity: "client",
    clientId: null,
    taskTypeId: null,
    key: "industry",
    label: "Industry",
    helpText: null,
    type: "text",
    options: [],
    required: false,
    section: null,
    position: "a",
    archivedAt: null,
    ...overrides,
  };
}

describe("customFieldChanges (3.4)", () => {
  const industry = definition({
    key: "industry",
    label: "Industry",
    type: "select",
    options: [
      { key: "weddings", label: "Weddings" },
      { key: "fashion", label: "Fashion" },
    ],
  });
  const size = definition({ key: "size", label: "Team size", type: "number", position: "b" });
  const old = definition({ key: "old", label: "Old", archivedAt: "2026-09-01T00:00:00Z" });

  it("names a select change by its labels", () => {
    expect(
      customFieldChanges(
        [industry],
        { industry: "weddings" },
        { industry: "fashion" },
        "Sharma Weddings",
      ),
    ).toEqual(["Sharma Weddings' Industry will change from Weddings to Fashion."]);
  });

  it("treats a number typed back as the same text as no change", () => {
    expect(customFieldChanges([size], { size: 12 }, { size: "12" }, "Asha")).toEqual([]);
  });

  it("names a value added and removed", () => {
    expect(customFieldChanges([size], {}, { size: "4" }, "Asha")).toEqual([
      "Asha's Team size will be set to 4.",
    ]);
    expect(customFieldChanges([size], { size: 4 }, {}, "Asha")).toEqual([
      "Asha's Team size will be removed.",
    ]);
  });

  it("never reports an archived field", () => {
    expect(customFieldChanges([old], { old: "a" }, { old: "b" }, "Asha")).toEqual([]);
  });
});
