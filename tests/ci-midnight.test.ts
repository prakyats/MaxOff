import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { waitBeforeE2e } from "../scripts/lib/ist-midnight.mjs";

/**
 * A CI e2e run never crosses midnight IST (ARCHITECTURE §15, 2026-09-30): one that could still be
 * going at the 23:59 IST job waits until 00:01 IST, before the local stack starts.
 */
const at = (utc: string) => new Date(`2026-09-29T${utc}Z`);
const minutes = (ms: number) => ms / 60_000;

describe("when a CI e2e run may start", () => {
  it("starts at once when it ends well before 23:59 IST", () => {
    expect(waitBeforeE2e(at("17:58:59"))).toBe(0);
    expect(waitBeforeE2e(at("06:00:00"))).toBe(0);
  });

  it("waits until 00:01 IST when it could still be going at the 23:59 IST job", () => {
    expect(minutes(waitBeforeE2e(at("17:59:00")))).toBe(32);
    // PR #25's first run started its tests at 18:26 UTC and went red at midnight.
    expect(minutes(waitBeforeE2e(at("18:23:00")))).toBe(8);
    expect(minutes(waitBeforeE2e(at("18:30:30")))).toBe(0.5);
  });

  it("starts at once from 00:01 IST, in the new day", () => {
    expect(waitBeforeE2e(at("18:31:00"))).toBe(0);
    expect(waitBeforeE2e(at("23:59:59"))).toBe(0);
  });
});

describe("the CI e2e job", () => {
  const ci = readFileSync(join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");
  const e2e = ci.slice(ci.indexOf("\n  e2e:"), ci.indexOf("\n  playwright:"));

  it("waits before the local stack starts, so the database and the run share one day", () => {
    const wait = e2e.indexOf("node scripts/wait-for-ist-day.mjs");
    expect(wait, "the wait step").toBeGreaterThan(-1);
    expect(wait).toBeLessThan(e2e.indexOf("supabase start"));
  });

  it("has room in its time limit for the longest wait", () => {
    const limit = Number(e2e.match(/timeout-minutes: (\d+)/)?.[1]);
    expect(limit).toBeGreaterThanOrEqual(32 + 30);
  });
});
