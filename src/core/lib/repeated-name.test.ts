import { describe, expect, it } from "vitest";

import { repeatedName, repeatedStageMessage } from "./repeated-name";

describe("repeatedName (the 7B rework's review, S3)", () => {
  it("is null when every name is its own", () => {
    expect(repeatedName([])).toBeNull();
    expect(repeatedName(["Script", "Shoot", "Edit"])).toBeNull();
  });

  it("finds a repeat ignoring case and outer spaces, as the second one was typed", () => {
    expect(repeatedName(["Edit", "Shoot", " EDIT "])).toBe("EDIT");
    expect(repeatedName(["shoot", "Shoot"])).toBe("Shoot");
  });

  it("leaves empty lines to the list's own check", () => {
    expect(repeatedName(["", " ", "Edit"])).toBeNull();
  });

  it("words the message the forms show", () => {
    expect(repeatedStageMessage("Edit")).toBe(
      "The stage Edit is listed twice: each stage needs its own name.",
    );
  });
});
