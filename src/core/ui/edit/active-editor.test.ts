import { describe, expect, it } from "vitest";

import { claimEditor, releaseEditor } from "./active-editor";

describe("one record in edit mode at a time (3.4)", () => {
  it("refuses a second record until the first is released", () => {
    expect(claimEditor("details")).toBe(true);
    expect(claimEditor("details")).toBe(true);
    expect(claimEditor("notes")).toBe(false);
    releaseEditor("notes");
    expect(claimEditor("notes")).toBe(false);
    releaseEditor("details");
    expect(claimEditor("notes")).toBe(true);
    releaseEditor("notes");
  });
});
