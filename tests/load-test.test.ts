import { describe, expect, it } from "vitest";

import { assertLoadTarget, isLoadEmail, loadPerson } from "../scripts/lib/load-guard.mjs";
import {
  istMinutes,
  percentile,
  refusalOf,
  rushWindowRefusal,
  tally,
  verdict,
} from "../scripts/lib/load-report.mjs";

const STAGING_DB = "https://abcdefghijklmnop.supabase.co";
const STAGING_APP = "https://maxoff-staging.example.workers.dev";

describe("the rush test's target guard (staging only)", () => {
  it("allows staging, a preview of it and this machine", () => {
    expect(() => assertLoadTarget({ base: STAGING_APP, supabaseUrl: STAGING_DB })).not.toThrow();
    // Staging's real Worker shares the account's subdomain with production's (Preview run
    // 45673706796 refused it as production).
    for (const base of [
      "https://maxoff-staging.pixoraclips.workers.dev",
      "https://phase-v70-maxoff-staging.pixoraclips.workers.dev",
    ]) {
      expect(() => assertLoadTarget({ base, supabaseUrl: STAGING_DB })).not.toThrow();
    }
    expect(() =>
      assertLoadTarget({ base: "http://localhost:3100", supabaseUrl: "http://127.0.0.1:54321" }),
    ).not.toThrow();
  });

  it("refuses production's app and production's database", () => {
    for (const base of [
      "https://app.maxoff.in",
      "https://maxoff.in",
      // Production's own Worker (deploy.yml's smoke check; it redirects to app.maxoff.in).
      "https://maxoff.pixoraclips.workers.dev",
      "https://maxoff.example.workers.dev",
    ]) {
      expect(() => assertLoadTarget({ base, supabaseUrl: STAGING_DB })).toThrow(/production/);
    }
    expect(() =>
      assertLoadTarget({
        base: STAGING_APP,
        supabaseUrl: "https://peshoflxypujbzecgwqq.supabase.co",
      }),
    ).toThrow(/production/);
  });

  it("refuses anything else, and a mixed local and remote pair", () => {
    expect(() =>
      assertLoadTarget({ base: "https://example.com", supabaseUrl: STAGING_DB }),
    ).toThrow();
    expect(() =>
      assertLoadTarget({
        base: "http://maxoff-staging.example.workers.dev",
        supabaseUrl: STAGING_DB,
      }),
    ).toThrow();
    expect(() =>
      assertLoadTarget({ base: "http://localhost:3100", supabaseUrl: STAGING_DB }),
    ).toThrow();
    // Another Worker on the account is not staging.
    expect(() =>
      assertLoadTarget({
        base: "https://other-app.pixoraclips.workers.dev",
        supabaseUrl: STAGING_DB,
      }),
    ).toThrow();
    expect(() =>
      assertLoadTarget({ base: STAGING_APP, supabaseUrl: "https://db.example.com" }),
    ).toThrow();
  });

  it("names the made-up people so they can never be real", () => {
    expect(loadPerson(3)).toEqual({ email: "load-03@rush-test.invalid", fullName: "Rush test 03" });
    expect(isLoadEmail("load-03@rush-test.invalid")).toBe(true);
    expect(isLoadEmail("someone@maxoff.in")).toBe(false);
  });
});

describe("the rush test's verdict (owner Q6)", () => {
  const person = (waitMs: number, extra = {}) => ({
    ok: true,
    status: 200,
    waitMs,
    rows: 1,
    started: 1,
    ...extra,
  });

  it("takes percentiles by nearest rank", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(percentile([], 50)).toBeNull();
  });

  it("passes when all go through, none doubled, and 19 of 20 wait under 3 s", () => {
    const people = [...Array.from({ length: 19 }, () => person(900)), person(4200)];
    expect(verdict(people)).toMatchObject({ pass: true, underLimit: 19, failed: 0, doubled: 0 });
  });

  it("fails on a second slow person, a failure or a doubled day", () => {
    const slow = [...Array.from({ length: 18 }, () => person(900)), person(3100), person(3000)];
    expect(verdict(slow).pass).toBe(false);
    const failed = [...Array.from({ length: 19 }, () => person(900)), person(900, { ok: false })];
    expect(verdict(failed).pass).toBe(false);
    const doubled = [...Array.from({ length: 19 }, () => person(900)), person(900, { rows: 2 })];
    expect(verdict(doubled).pass).toBe(false);
  });
});

describe("the rush test's log lines (Preview 45674894596)", () => {
  it("tallies answers, most often first", () => {
    expect(tally([200, 400, 400, 200, 400])).toBe("400×3 · 200×2");
    expect(tally([])).toBe("");
  });

  it("names a refusal in the database's own words, short", () => {
    expect(
      refusalOf(
        400,
        JSON.stringify({
          code: "P0001",
          message: "INVALID_STATE",
          details: "Attendance starts tomorrow.",
        }),
      ),
    ).toBe("400 INVALID_STATE: Attendance starts tomorrow.");
    expect(refusalOf(429, "Too many\nrequests")).toBe("429 Too many requests");
    expect(refusalOf(500, "x".repeat(400))).toHaveLength(160);
  });
});

describe("the rush test's IST window (Preview 45674894596 crossed midnight)", () => {
  const at = (iso: string) => Date.parse(iso);
  it("reads IST minutes", () => {
    expect(istMinutes(at("2026-11-25T18:29:20Z"))).toBe(23 * 60 + 59);
    expect(istMinutes(at("2026-11-25T18:30:00Z"))).toBe(0);
  });

  it("allows 22:00 to 23:45 IST, the spread included", () => {
    expect(rushWindowRefusal(at("2026-11-25T16:30:00Z"), 60_000)).toBeNull(); // 22:00
    expect(rushWindowRefusal(at("2026-11-25T18:14:00Z"), 60_000)).toBeNull(); // 23:44 + 1 min
  });

  it("refuses before 22:00 and anything that could reach midnight", () => {
    expect(rushWindowRefusal(at("2026-11-25T16:29:00Z"), 60_000)).toMatch(/after 22:00/);
    expect(rushWindowRefusal(at("2026-11-25T18:29:20Z"), 60_000)).toMatch(/midnight/);
    expect(rushWindowRefusal(at("2026-11-25T18:15:00Z"), 60_000)).toMatch(/23:45/);
  });
});
