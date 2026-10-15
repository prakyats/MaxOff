import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import config from "../playwright.config";

/**
 * CI shards Playwright over four runners by naming the projects each shard runs, and runs
 * `owner-bulk` (then `push-cron`) alone after the rest of the last shard (`.github/workflows/ci.yml`,
 * owner decisions 2026-09-28 and 2026-10-09, 6b.0). A project added to `playwright.config.ts` but
 * not to that list would silently never run in CI; this keeps the two in step.
 */
const CI = readFileSync(join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");
const names = (config.projects ?? []).map((project) => project.name ?? "");
/** The projects that run alone, after the sharded step, each in its own step. */
const SERIAL = ["owner-bulk", "push-cron"];

/** The sharded step's command: from `pnpm test:e2e --shard=` up to the next step. */
function shardStep(): string {
  const start = CI.indexOf("pnpm test:e2e --shard=");
  expect(start, "ci.yml has a sharded Playwright step").toBeGreaterThan(-1);
  const end = CI.indexOf("\n      - ", start);
  return CI.slice(start, end === -1 ? undefined : end);
}

/** The step (from its `- name:` line) whose command holds `needle`, with its `if:`. */
function stepWith(needle: string): string {
  const at = CI.indexOf(needle);
  expect(at, `ci.yml runs ${needle}`).toBeGreaterThan(-1);
  return CI.slice(CI.lastIndexOf("\n      - ", at), at);
}

describe("the CI Playwright shards", () => {
  it("are four, each its own runner with one worker", () => {
    expect(CI).toMatch(/^\s+shard: \[1, 2, 3, 4\]$/m);
    expect(CI).toContain("name: playwright (shard ${{ matrix.shard }}/4)");
    expect(shardStep()).toContain("--shard=${{ matrix.shard }}/4");
    expect(shardStep()).toContain("--workers=1");
    expect(CI).not.toContain("}}/2");
  });

  it("run every project but the serial ones, in every shard", () => {
    for (const name of SERIAL) expect(names).toContain(name);
    const step = shardStep();
    for (const name of names.filter((n) => !SERIAL.includes(n))) {
      expect(step, `ci.yml's shard step runs --project=${name}`).toMatch(
        new RegExp(`--project=${name}(\\s|$)`, "m"),
      );
    }
    for (const name of SERIAL) {
      expect(step, `${name} is not sharded`).not.toContain(`--project=${name}`);
    }
  });

  it("run owner-bulk alone after the rest of shard 4, then push-cron after it", () => {
    const shard = CI.indexOf("pnpm test:e2e --shard=");
    const bulk = "--project=owner-bulk --no-deps";
    const cron = "--project=push-cron --no-deps";
    expect(stepWith(bulk)).toContain("if: matrix.shard == 4");
    expect(stepWith(cron)).toContain("if: matrix.shard == 4");
    expect(CI.indexOf(bulk)).toBeGreaterThan(shard);
    expect(CI.indexOf(cron)).toBeGreaterThan(CI.indexOf(bulk));
  });

  it("keep the required checks' names, and the merge job requires every shard", () => {
    expect(CI).toMatch(/^ {4}name: playwright$/m);
    expect(CI).toMatch(/^ {4}name: pgTAP$/m);
    expect(CI).toMatch(/^ {4}name: typecheck · lint · format · unit · build$/m);
    expect(CI).toContain("name: All four shards passed");
  });
});
