import { describe, expect, it } from "vitest";

import { describeBoundaryError, SESSION_UNAVAILABLE_DIGEST } from "./boundary";

describe("describeBoundaryError", () => {
  it("tells a transient session failure apart: still signed in, try again", () => {
    const copy = describeBoundaryError({ digest: SESSION_UNAVAILABLE_DIGEST });
    expect(copy.kind).toBe("session-unavailable");
    expect(copy.title).toBe("Can't reach the server.");
    expect(copy.description).toContain("You're still signed in");
    expect(copy.description).not.toContain("Reference");
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
