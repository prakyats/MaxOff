import { describe, expect, it } from "vitest";

import { shouldRegisterServiceWorker } from "./should-register";

describe("shouldRegisterServiceWorker", () => {
  it("registers only in a production build with service worker support", () => {
    expect(shouldRegisterServiceWorker({ nodeEnv: "production", hasServiceWorker: true })).toBe(
      true,
    );
  });

  it("stays off under next dev, in tests and when unset", () => {
    for (const nodeEnv of ["development", "test", "", undefined]) {
      expect(shouldRegisterServiceWorker({ nodeEnv, hasServiceWorker: true })).toBe(false);
    }
  });

  it("stays off in a browser without service workers", () => {
    expect(shouldRegisterServiceWorker({ nodeEnv: "production", hasServiceWorker: false })).toBe(
      false,
    );
  });
});
