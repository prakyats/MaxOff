import { describe, expect, it } from "vitest";

import { can } from "@/core/permissions";
import { navFor, PROFILE_NAV_ITEM } from "@/core/ui/shell/nav";

import {
  judgeRoute,
  judgeRun,
  MEMBER_ROUTES,
  median,
  planMemberRoutes,
  NOT_GATED,
  SLOWER_PCT_FLOOR_MS,
  SLOWER_THAN_STAGING_MS,
  SLOWER_THAN_STAGING_PCT,
  slowerThanStaging,
  summaryLine,
  twoRunVerdicts,
  WARM_TTFB_P50_LIMIT_MS,
} from "../scripts/lib/perf-gate.mjs";

/**
 * The perf probe's speed gate (v1.8; owner #89 comment 6332543899, advisor comment 6349679713):
 * which routes it probes for each role, and when a route fails. Option A (owner 2026-11-11, "judge
 * finished page too"): the TTFB against the v2.0 cap only, the last byte against staging, and
 * slower only in two consecutive runs.
 */
const ROLES = ["owner", "admin", "staff"] as const;

describe("the thresholds", () => {
  it("are the owner's numbers", () => {
    expect(WARM_TTFB_P50_LIMIT_MS).toBe(600); // CLAUDE.md's cap from CI
    expect(SLOWER_THAN_STAGING_PCT).toBe(10);
    expect(SLOWER_THAN_STAGING_MS).toBe(100);
    expect(SLOWER_PCT_FLOOR_MS).toBe(50);
    expect([...NOT_GATED]).toEqual(["/api/warm", "static (no Worker)", "404 (Worker, no data)"]);
  });
});

describe("slowerThanStaging (> 100 ms, or > 10 % and ≥ 50 ms; > 10 % under 50 ms warns)", () => {
  it("fails on more than 10 % when it is also at least 50 ms", () => {
    expect(slowerThanStaging(551, 500)).toBe("fail"); // +51 ms, +10.2 %
    expect(slowerThanStaging(550, 500)).toBe("ok"); // exactly +10 %
  });
  it("warns on more than 10 % under 50 ms: noise on a fast route", () => {
    expect(slowerThanStaging(331, 300)).toBe("warn"); // +31 ms, +10.3 %
    expect(slowerThanStaging(8, 7)).toBe("warn"); // +1 ms, +14 %
  });
  it("fails on more than 100 ms even under 10 %", () => {
    expect(slowerThanStaging(2101, 2000)).toBe("fail"); // +101 ms, +5 %
    expect(slowerThanStaging(2100, 2000)).toBe("ok"); // exactly +100 ms, +5 %
  });
  it("passes a faster or equal route", () => {
    expect(slowerThanStaging(250, 300)).toBe("ok");
    expect(slowerThanStaging(300, 300)).toBe("ok");
  });
});

describe("judgeRoute (option A: the TTFB against the cap, the last byte against staging)", () => {
  const ok = { name: "/today", statusOk: true, statuses: "200" };

  it("passes a TTFB at the cap and fails one just above it", () => {
    expect(judgeRoute({ ...ok, warmP50: WARM_TTFB_P50_LIMIT_MS }).verdict).toBe("PASS");
    const slow = judgeRoute({ ...ok, warmP50: 612 });
    expect(slow.verdict).toBe("FAIL");
    expect(slow.reasons).toEqual(["warm p50 612 > 600 ms"]);
  });

  it("fails a finished page slower than staging's, and says by how much", () => {
    const j = judgeRoute(
      { ...ok, warmP50: 320, warmTotalP50: 650 },
      { ...ok, warmP50: 300, warmTotalP50: 500 },
    );
    expect(j.verdict).toBe("FAIL");
    expect(j).toMatchObject({ totalP50: 650, baselineTotalP50: 500 });
    expect(j.reasons).toEqual(["last byte +150 ms (+30 %) vs staging"]);
  });

  it("only warns on a TTFB later than staging's under the cap: the finished page decides", () => {
    // v2's first flush carries the content: a later first byte, a sooner finished page.
    const j = judgeRoute(
      { ...ok, warmP50: 372, warmTotalP50: 380 },
      { ...ok, warmP50: 291, warmTotalP50: 509 },
    );
    expect(j.verdict).toBe("WARN");
    expect(j.reasons).toEqual(["TTFB +81 ms (+28 %) vs staging"]);
  });

  it("warns, without failing, on a small last-byte slow-down past 10 %", () => {
    const j = judgeRoute(
      { ...ok, warmP50: 300, warmTotalP50: 331 },
      { ...ok, warmP50: 300, warmTotalP50: 300 },
    );
    expect(j.verdict).toBe("WARN");
    expect(j.reasons).toEqual(["last byte +31 ms (+10 %) vs staging"]);
  });

  it("shows the hosting rows' timing but never judges it", () => {
    for (const name of NOT_GATED) {
      const j = judgeRoute(
        { ...ok, name, warmP50: 900, warmTotalP50: 900 },
        { ...ok, warmP50: 5, warmTotalP50: 5 },
      );
      expect(j.verdict).toBe("INFO");
      expect(j.reasons.length).toBeGreaterThan(0);
    }
  });

  it("still fails a hosting row on its status", () => {
    const j = judgeRoute({ ...ok, name: "static (no Worker)", statusOk: false, statuses: "502" });
    expect(j.verdict).toBe("FAIL");
    expect(j.reasons).toEqual(["status 502"]);
  });

  it("lists every failing reason", () => {
    const j = judgeRoute(
      { ...ok, warmP50: 900, warmTotalP50: 1200 },
      { ...ok, warmP50: 500, warmTotalP50: 900 },
    );
    expect(j.verdict).toBe("FAIL");
    expect(j.reasons).toEqual(["warm p50 900 > 600 ms", "last byte +300 ms (+33 %) vs staging"]);
  });

  it("fails a route that answered with the wrong status, however fast", () => {
    const j = judgeRoute({ name: "/people", statusOk: false, statuses: "200/500", warmP50: 80 });
    expect(j.verdict).toBe("FAIL");
    expect(j.reasons).toEqual(["status 200/500"]);
  });

  it("does not compare with a staging row that was skipped or broken", () => {
    const fast = { ...ok, warmP50: 400, warmTotalP50: 900 };
    expect(judgeRoute(fast, { name: "/today", skip: "x" }).verdict).toBe("PASS");
    expect(
      judgeRoute(fast, { ...ok, statusOk: false, warmP50: 50, warmTotalP50: 50 }).verdict,
    ).toBe("PASS");
  });

  it("skips a skipped route", () => {
    const j = judgeRoute({ name: "/reports", skip: "the Crew can't open it" });
    expect(j).toMatchObject({ verdict: "SKIP", skip: "the Crew can't open it" });
  });
});

describe("judgeRun and summaryLine", () => {
  const run = [
    { name: "/today", statusOk: true, warmP50: 300, warmTotalP50: 900 },
    { name: "/tasks", statusOk: true, warmP50: 700, warmTotalP50: 900 },
    { name: "/reports", skip: "the Crew can't open it" },
  ];

  it("matches staging by route name; a route staging lacks is judged on the cap only", () => {
    const judged = judgeRun(run, [
      { name: "/today", statusOk: true, warmP50: 200, warmTotalP50: 600 },
    ]);
    expect(judged.map((j) => j.verdict)).toEqual(["FAIL", "FAIL", "SKIP"]);
    // A failing route lists what fails it (the TTFB's own warning is not repeated).
    expect(judged[0]?.reasons).toEqual(["last byte +300 ms (+50 %) vs staging"]);
    expect(judged[1]?.baselineP50).toBeUndefined();
  });

  it("says FAIL with the failing routes, and PASS when none fail", () => {
    const line = summaryLine(judgeRun(run, null), { compared: false });
    expect(line).toMatch(/^\*\*Speed gate: FAIL\*\*: 1 of 2 probed routes fail, 1 skipped/);
    expect(line).toContain("/tasks (warm p50 700 > 600 ms)");
    expect(summaryLine(judgeRun(run.slice(0, 1), null), { compared: true })).toMatch(
      /^\*\*Speed gate: PASS\*\*: no probed route fails, of 1 .*the last byte \(the finished page\) not slower than staging/,
    );
    const warned = summaryLine(
      judgeRun(
        [{ name: "/today", statusOk: true, warmP50: 372, warmTotalP50: 380 }],
        [{ name: "/today", statusOk: true, warmP50: 291, warmTotalP50: 509 }],
      ),
      { compared: true },
    );
    expect(warned).toMatch(/^\*\*Speed gate: PASS\*\*/);
    expect(warned).toContain("WARN (shown, not failing): /today (TTFB +81 ms (+28 %) vs staging)");
  });
});

describe("twoRunVerdicts (slower only in two consecutive runs; one slow run is re-probed)", () => {
  const judged = (verdict: "PASS" | "WARN" | "FAIL" | "SKIP") => ({
    name: "/approvals",
    verdict,
    reasons: [] as string[],
  });

  it("fails a route only when it failed in the run before too", () => {
    expect(twoRunVerdicts([judged("FAIL")], [judged("FAIL")])).toEqual([
      { name: "/approvals", verdict: "FAIL" },
    ]);
  });

  it("re-probes a route that failed once: never failed, never waived", () => {
    expect(twoRunVerdicts([judged("FAIL")], [judged("PASS")])).toEqual([
      { name: "/approvals", verdict: "RECHECK" },
    ]);
    expect(twoRunVerdicts([judged("FAIL")], null)).toEqual([
      { name: "/approvals", verdict: "RECHECK" },
    ]);
  });

  it("passes a route that passes or only warns now, whatever the run before said", () => {
    expect(twoRunVerdicts([judged("PASS")], [judged("FAIL")])[0]?.verdict).toBe("PASS");
    expect(twoRunVerdicts([judged("WARN")], [judged("FAIL")])[0]?.verdict).toBe("PASS");
    expect(twoRunVerdicts([judged("SKIP")], null)[0]?.verdict).toBe("SKIP");
  });
});

describe("median", () => {
  it("is the middle sample, the upper one of an even count", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(3);
    expect(median([])).toBe(0);
  });
});

describe("the routes", () => {
  it("cover every role's tabs, More items, Me and the bell, for exactly the roles that have them", () => {
    for (const role of ROLES) {
      const nav = [...navFor(role), PROFILE_NAV_ITEM]
        .filter((item) => item.permission === null || can(role, item.permission))
        .flatMap((item) => [item.href, ...(item.paths ?? [])]);
      const expected = new Set([...nav, "/notifications"]);
      for (const href of expected) {
        const route = MEMBER_ROUTES.find((r) => r.path === href);
        expect(route, `${href} for ${role}`).toBeDefined();
        expect(route?.roles, `${href} for ${role}`).toContain(role);
      }
      // A plain tab route listed for a role must be one of that role's own.
      for (const route of MEMBER_ROUTES) {
        if (route.needs || !route.roles.includes(role)) continue;
        const own = [...expected].some(
          (href) => route.path === href || route.path.startsWith(`${href}/`),
        );
        expect(own || route.path.startsWith("/diagnostics/"), `${route.path} for ${role}`).toBe(
          true,
        );
      }
    }
  });

  it("include one task, client, project and person", () => {
    const named = MEMBER_ROUTES.filter((r) => r.needs).map((r) => r.name);
    expect(named).toEqual(["a task", "a client", "a project", "a person"]);
  });

  it("fill ids from what the member sees, and skip what the role can't open or has none of", () => {
    const ids = {
      task: "t1",
      client: "c1",
      project: "p1",
      projectClient: "c2",
      person: null,
    };
    const owner = planMemberRoutes("owner", ids);
    expect(owner.find((r) => r.name === "a project")).toEqual({
      name: "a project",
      path: "/clients/c2/projects/p1",
    });
    expect(owner.find((r) => r.name === "a person")).toEqual({
      name: "a person",
      skip: "no person this member can see",
    });
    expect(owner.find((r) => r.name === "/my-day")?.skip).toBe("the Owner can't open it");

    const crew = planMemberRoutes("staff", ids);
    expect(crew.find((r) => r.name === "a task")?.path).toBe("/tasks/t1");
    for (const name of ["/today", "/approvals", "/clients", "/people", "/reports", "a client"]) {
      expect(crew.find((r) => r.name === name)?.skip, name).toBe("the Crew can't open it");
    }
    expect(planMemberRoutes("admin", ids).find((r) => r.name === "/leave")?.path).toBe("/leave");
  });
});
