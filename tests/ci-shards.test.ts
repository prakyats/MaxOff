import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import config from "../playwright.config";

/**
 * CI shards Playwright over two runners by naming the projects each shard runs, and runs
 * `owner-bulk` alone afterwards (`.github/workflows/ci.yml`, owner decision 2026-09-28). A project
 * added to `playwright.config.ts` but not to that list would silently never run in CI; this
 * keeps the two in step.
 */
const CI = readFileSync(join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");
const names = (config.projects ?? []).map((project) => project.name ?? "");

describe("the CI Playwright shards", () => {
  it("run every project but owner-bulk, in both shards", () => {
    expect(names).toContain("owner-bulk");
    for (const name of names.filter((n) => n !== "owner-bulk")) {
      expect(CI, `ci.yml's shard step runs --project=${name}`).toMatch(
        new RegExp(`--project=${name}(\\s|$)`, "m"),
      );
    }
    expect(CI).toContain("--shard=${{ matrix.shard }}/2");
  });

  it("run owner-bulk alone after the rest, without its dependencies", () => {
    expect(CI).toContain("--project=owner-bulk --no-deps");
  });
});
