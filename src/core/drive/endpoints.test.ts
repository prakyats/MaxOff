import { describe, expect, it } from "vitest";

import { fakeGoogleOrigin, googleOrigins } from "./endpoints";

const REAL = { oauth: "https://oauth2.googleapis.com", api: "https://www.googleapis.com" };

describe("Google's addresses (the e2e's fake Google is a local run's only)", () => {
  it("Google's own by default", () => {
    expect(googleOrigins({})).toEqual(REAL);
    expect(fakeGoogleOrigin({})).toBeNull();
  });
  it("a local run may name a fake on this machine", () => {
    const env = { GOOGLE_API_ORIGIN_FOR_TESTS: "http://127.0.0.1:54340" };
    expect(googleOrigins(env)).toEqual({
      oauth: "http://127.0.0.1:54340",
      api: "http://127.0.0.1:54340",
    });
    expect(fakeGoogleOrigin(env)).toBe("http://127.0.0.1:54340");
  });
  it("staging and production never honour it; nor a fake elsewhere", () => {
    for (const appEnv of ["staging", "production"]) {
      expect(
        googleOrigins({
          NEXT_PUBLIC_APP_ENV: appEnv,
          GOOGLE_API_ORIGIN_FOR_TESTS: "http://127.0.0.1:1",
        }),
      ).toEqual(REAL);
    }
    expect(googleOrigins({ GOOGLE_API_ORIGIN_FOR_TESTS: "https://evil.example" })).toEqual(REAL);
    expect(googleOrigins({ GOOGLE_API_ORIGIN_FOR_TESTS: "not a url" })).toEqual(REAL);
  });
});
