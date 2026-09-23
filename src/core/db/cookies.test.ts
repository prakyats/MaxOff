import { describe, expect, it } from "vitest";

import { sessionCookieOptions } from "./cookies";

describe("sessionCookieOptions", () => {
  it("hides the session cookies from scripts and keeps them same-site", () => {
    for (const env of ["local", "staging", "production", undefined]) {
      const options = sessionCookieOptions(env);
      expect(options.httpOnly, `httpOnly for ${env}`).toBe(true);
      expect(options.sameSite, `sameSite for ${env}`).toBe("lax");
    }
  });

  it("marks them Secure on every deployed build and not on a local http run", () => {
    expect(sessionCookieOptions("staging").secure).toBe(true);
    expect(sessionCookieOptions("production").secure).toBe(true);
    expect(sessionCookieOptions("local").secure).toBe(false);
    expect(sessionCookieOptions(undefined).secure).toBe(false);
  });
});
