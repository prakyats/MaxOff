import { describe, expect, it } from "vitest";

import { appVersionFrom } from "./app-version";

describe("appVersionFrom (5B decision 4, B11)", () => {
  const sha = "36b4b95b5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";

  it("is the release tag for a production build made from one", () => {
    expect(
      appVersionFrom({
        GITHUB_REF_TYPE: "tag",
        GITHUB_REF_NAME: "v1.7.1",
        GITHUB_SHA: sha,
        NEXT_PUBLIC_APP_ENV: "production",
      }),
    ).toBe("v1.7.1");
  });

  it("is the environment and the 7-character commit for a staging or preview build", () => {
    expect(
      appVersionFrom({
        GITHUB_REF_TYPE: "branch",
        GITHUB_REF_NAME: "main",
        GITHUB_SHA: sha,
        NEXT_PUBLIC_APP_ENV: "staging",
      }),
    ).toBe("staging · 36b4b95");
  });

  it("is the branch and the short commit for a CI build with no environment", () => {
    expect(
      appVersionFrom({ GITHUB_REF_TYPE: "branch", GITHUB_REF_NAME: "main", GITHUB_SHA: sha }),
    ).toBe("main · 36b4b95");
  });

  it("is the commit alone without a branch, and local outside CI", () => {
    expect(appVersionFrom({ GITHUB_SHA: sha })).toBe("36b4b95");
    expect(appVersionFrom({})).toBe("local");
  });
});
