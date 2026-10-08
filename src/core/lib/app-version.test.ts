import { describe, expect, it } from "vitest";

import { appVersionFrom } from "./app-version";

describe("appVersionFrom (5B decision 4)", () => {
  const sha = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";

  it("is the release tag for a build made from one", () => {
    expect(
      appVersionFrom({ GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v1.3.0", GITHUB_SHA: sha }),
    ).toBe("v1.3.0");
  });

  it("is the branch and the short commit for a staging or preview build", () => {
    expect(
      appVersionFrom({ GITHUB_REF_TYPE: "branch", GITHUB_REF_NAME: "main", GITHUB_SHA: sha }),
    ).toBe("main · 1a2b3c4d");
  });

  it("is the commit alone without a branch, and local outside CI", () => {
    expect(appVersionFrom({ GITHUB_SHA: sha })).toBe("1a2b3c4d");
    expect(appVersionFrom({})).toBe("local");
  });
});
