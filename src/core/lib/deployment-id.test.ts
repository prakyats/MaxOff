import { describe, expect, it } from "vitest";

import { deploymentIdFrom } from "./deployment-id";

describe("deploymentIdFrom (P2, ADR-0014)", () => {
  it("one per build on GitHub Actions: the commit, the run and its attempt", () => {
    expect(
      deploymentIdFrom({
        GITHUB_SHA: "1a2b3c4d5e6f7a8b9c0d",
        GITHUB_RUN_ID: "38776216005",
        GITHUB_RUN_ATTEMPT: "2",
      }),
    ).toBe("1a2b3c4d5e6f-38776216005-2");
    // A re-run of the same commit is a new build, so a new id.
    expect(deploymentIdFrom({ GITHUB_SHA: "1a2b3c4d5e6f7a8b", GITHUB_RUN_ID: "1" })).toBe(
      "1a2b3c4d5e6f-1-1",
    );
  });

  it("local elsewhere, and only header-safe characters", () => {
    expect(deploymentIdFrom({})).toBe("local");
    expect(deploymentIdFrom({ GITHUB_SHA: "ab cd/ef" })).toBe("abcdef");
  });
});
