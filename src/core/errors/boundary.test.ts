import { describe, expect, it } from "vitest";

import { describeBoundaryError, isJwtExpiredError, SESSION_UNAVAILABLE_DIGEST } from "./boundary";

describe("describeBoundaryError", () => {
  it("tells a transient session failure apart: still signed in, try again", () => {
    const copy = describeBoundaryError({ digest: SESSION_UNAVAILABLE_DIGEST });
    expect(copy.kind).toBe("session-unavailable");
    expect(copy.title).toBe("Can't reach the server.");
    expect(copy.description).toContain("You're still signed in");
    expect(copy.description).not.toContain("Reference");
  });

  it("says the same for PostgREST's expired-JWT error seen before Next scrubs it (6.6)", () => {
    const copy = describeBoundaryError(
      Object.assign(new Error("JWT expired"), { code: "PGRST303" }),
    );
    expect(copy.kind).toBe("session-unavailable");
    expect(describeBoundaryError(Object.assign(new Error("x"), { code: "PGRST301" })).kind).toBe(
      "generic",
    );
  });

  it("leaves a PGRST303 for any other refused claim to the generic copy (exp only)", () => {
    for (const message of ["JWT not yet valid", "JWT issued at future", "JWT not in audience"]) {
      expect(
        describeBoundaryError(Object.assign(new Error(message), { code: "PGRST303" })).kind,
      ).toBe("generic");
    }
    expect(describeBoundaryError({ code: "PGRST303" }).kind).toBe("generic");
  });
});

describe("isJwtExpiredError", () => {
  it("is PGRST303 whose message says expired, in any case", () => {
    expect(isJwtExpiredError({ code: "PGRST303", message: "JWT expired" })).toBe(true);
    expect(isJwtExpiredError({ code: "PGRST303", message: "jwt EXPIRED" })).toBe(true);
  });

  it("is nothing else: another claim, another code, no message", () => {
    expect(isJwtExpiredError({ code: "PGRST303", message: "JWT not yet valid" })).toBe(false);
    expect(isJwtExpiredError({ code: "PGRST303", message: "JWT not in audience" })).toBe(false);
    expect(isJwtExpiredError({ code: "PGRST303" })).toBe(false);
    expect(isJwtExpiredError({ code: "PGRST301", message: "JWT expired" })).toBe(false);
    expect(isJwtExpiredError(null)).toBe(false);
    expect(isJwtExpiredError("JWT expired")).toBe(false);
  });

  it("keeps the generic copy, with the reference code when Next forwards one", () => {
    expect(describeBoundaryError({ digest: "1234567890" })).toEqual({
      kind: "generic",
      title: "This page couldn't load",
      description: "Reference 1234567890. Try again, and mention this code if it keeps happening.",
    });
    expect(describeBoundaryError({})).toMatchObject({
      kind: "generic",
      description: "Try again in a moment.",
    });
  });
});
