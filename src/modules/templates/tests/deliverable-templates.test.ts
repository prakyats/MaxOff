import { describe, expect, it } from "vitest";

import { templateRowActions } from "../domain/deliverable-templates";

/**
 * Deliverable templates (6b Release 2, PERMISSIONS ⁴): shared, an Admin edits and archives their
 * own, the Owner any; an archived one is only restored.
 */
describe("deliverable templates", () => {
  const admin = { id: "admin", role: "admin" };
  const owner = { id: "owner", role: "owner" };

  it("an Admin edits and archives their own, never another's", () => {
    expect(templateRowActions({ createdBy: "admin", archived: false }, admin)).toEqual({
      edit: true,
      archive: true,
      restore: false,
    });
    expect(templateRowActions({ createdBy: "owner", archived: false }, admin)).toEqual({
      edit: false,
      archive: false,
      restore: false,
    });
  });

  it("the Owner edits any, and restores an archived one", () => {
    expect(templateRowActions({ createdBy: "admin", archived: false }, owner).edit).toBe(true);
    expect(templateRowActions({ createdBy: "admin", archived: true }, owner)).toEqual({
      edit: false,
      archive: false,
      restore: true,
    });
  });
});
