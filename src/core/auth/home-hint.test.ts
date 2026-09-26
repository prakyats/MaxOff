import { describe, expect, it } from "vitest";

import { formatHomeHint, readHomeHint, rootRedirect } from "./home-hint";

const MEMBER = "10000000-0000-4000-8000-000000000003";
const OTHER = "10000000-0000-4000-8000-000000000002";

describe("the proxy's answer for / (2.7)", () => {
  it("sends a matching hint straight to the role's home", () => {
    expect(rootRedirect(MEMBER, formatHomeHint(MEMBER, "staff"))).toBe("/my-day");
    expect(rootRedirect(MEMBER, formatHomeHint(MEMBER, "admin"))).toBe("/today");
    expect(rootRedirect(MEMBER, formatHomeHint(MEMBER, "owner"))).toBe("/today");
  });

  it("falls through on a stale hint: someone else's, or not a home", () => {
    expect(rootRedirect(MEMBER, formatHomeHint(OTHER, "staff"))).toBeNull();
    expect(rootRedirect(MEMBER, `${MEMBER}|/settings`)).toBeNull();
    expect(rootRedirect(MEMBER, `${MEMBER}|/`)).toBeNull();
    expect(rootRedirect(MEMBER, `${MEMBER}|//evil.example`)).toBeNull();
    expect(rootRedirect(MEMBER, `${MEMBER}|/today|extra`)).toBeNull();
    expect(rootRedirect(MEMBER, "/today")).toBeNull();
  });

  it("falls through with no hint", () => {
    expect(rootRedirect(MEMBER, undefined)).toBeNull();
    expect(rootRedirect(MEMBER, "")).toBeNull();
  });

  it("sends a signed-out visitor to sign-in, whatever the cookie says", () => {
    expect(rootRedirect(null, undefined)).toBe("/login");
    expect(rootRedirect(null, formatHomeHint(MEMBER, "staff"))).toBe("/login");
  });

  it("never answers / with /, so a hint cannot loop", () => {
    for (const role of ["owner", "admin", "staff"] as const) {
      expect(readHomeHint(formatHomeHint(MEMBER, role), MEMBER)).not.toBe("/");
    }
  });
});
