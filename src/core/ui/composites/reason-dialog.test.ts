import { describe, expect, it } from "vitest";

import { REASON_MAX_LENGTH, validateReason } from "./reason-dialog";

describe("validateReason", () => {
  it("requires a reason", () => {
    expect(validateReason("")).toBe("A reason is required.");
    expect(validateReason("   \n ")).toBe("A reason is required.");
  });

  it("rejects a reason that is too short or too long", () => {
    expect(validateReason("ok")).toBe("Please write a few more words.");
    expect(validateReason("x".repeat(REASON_MAX_LENGTH + 1))).toMatch(/Keep it under/);
  });

  it("accepts a real reason", () => {
    expect(validateReason("Client moved the shoot to Friday.")).toBeNull();
    expect(validateReason("  late  ")).toBeNull();
  });
});
