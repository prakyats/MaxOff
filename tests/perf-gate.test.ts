import { describe, expect, it } from "vitest";

import { can } from "@/core/permissions";
import { navFor, PROFILE_NAV_ITEM } from "@/core/ui/shell/nav";

import {
  judgeRoute,
  judgeRun,
  MEMBER_ROUTES,
  median,
  planMemberRoutes,
  SLOWER_THAN_STAGING_MS,
  SLOWER_THAN_STAGING_PCT,
  slowerThanStaging,
  summaryLine,
  WARM_TTFB_P50_LIMIT_MS,
} from "../scripts/lib/perf-gate.mjs";

/**
 * The perf probe's speed gate (v1.8; owner #89 comment 6332543899, advisor comment 6349679713):
 * which routes it probes for each role, and when a route fails.
 */
const ROLES = ["owner", "admin", "staff"] as const;

describe("the thresholds", () => {
  it("are the owner's numbers", () => {
    expect(WARM_TTFB_P50_LIMIT_MS).toBe(600);
    expect(SLOWER_THAN_STAGING_PCT).toBe(10);
    expect(SLOWER_THAN_STAGING_MS).toBe(100);
  });
});

describe("slowerThanStaging (> 10 % or > 100 ms)", () => {
  it("fails on more than 10 % even under 100 ms", () => {
    expect(slowerThanStaging(331, 300)).toBe(true); // +31 ms, +10.3 %
    expect(slowerThanStaging(330, 300)).toBe(false); // exactly +10 %
  });
  it("fails on more than 100 ms even under 10 %", () => {
    expect(slowerThanStaging(2101, 2000)).toBe(true); // +101 ms, +5 %
    expect(slowerThanStaging(2100, 2000)).toBe(false); // exactly +100 ms, +5 %
  });
  it("passes a faster or equal route", () => {
    expect(slowerThanStaging(250, 300)).toBe(false);
    expect(slowerThanStaging(300, 300)).toBe(false);
  });
});

describe("judgeRoute", () => {
  const ok = { name: "/today", statusOk: true, statuses: "200" };

  it("passes at the limit and fails just above it", () => {
    expect(judgeRoute({ ...ok, warmP50: WARM_TTFB_P50_LIMIT_MS }).verdict).toBe("PASS");
    const slow = judgeRoute({ ...ok, warmP50: 612 });
    expect(slow.verdict).toBe("FAIL");
    expect(slow.reasons).toEqual(["warm p50 612 > 600 ms"]);
  });

  it("fails a route slower than staging, and says by how much", () => {
    const j = judgeRoute({ ...ok, warmP50: 450 }, { ...ok, warmP50: 300 });
    expect(j.verdict).toBe("FAIL");
    expect(j.baselineP50).toBe(300);
    expect(j.reasons).toEqual(["+150 ms (+50 %) vs staging"]);
  });

  it("lists every reason", () => {
    const j = judgeRoute({ ...ok, warmP50: 900 }, { ...ok, warmP50: 500 });
    expect(j.reasons).toEqual(["warm p50 900 > 600 ms", "+400 ms (+80 %) vs staging"]);
  });

  it("fails a route that answered with the wrong status, however fast", () => {
    const j = judgeRoute({ name: "/people", statusOk: false, statuses: "200/500", warmP50: 80 });
    expect(j.verdict).toBe("FAIL");
    expect(j.reasons).toEqual(["status 200/500"]);
  });

  it("does not compare with a staging row that was skipped or broken", () => {
    const fast = { ...ok, warmP50: 400 };
    expect(judgeRoute(fast, { name: "/today", skip: "x" }).verdict).toBe("PASS");
    expect(judgeRoute(fast, { ...ok, statusOk: false, warmP50: 50 }).verdict).toBe("PASS");
  });

  it("skips a skipped route", () => {
    const j = judgeRoute({ name: "/reports", skip: "the Crew can't open it" });
    expect(j).toMatchObject({ verdict: "SKIP", skip: "the Crew can't open it" });
  });
});

describe("judgeRun and summaryLine", () => {
  const run = [
    { name: "/today", statusOk: true, warmP50: 300 },
    { name: "/tasks", statusOk: true, warmP50: 700 },
    { name: "/reports", skip: "the Crew can't open it" },
  ];

  it("matches staging by route name; a route staging lacks is judged on 600 ms only", () => {
    const judged = judgeRun(run, [{ name: "/today", statusOk: true, warmP50: 200 }]);
    expect(judged.map((j) => j.verdict)).toEqual(["FAIL", "FAIL", "SKIP"]);
    expect(judged[1]?.baselineP50).toBeUndefined();
  });

  it("says FAIL with the failing routes, and PASS when none fail", () => {
    const line = summaryLine(judgeRun(run, null), { compared: false });
    expect(line).toMatch(/^\*\*Speed gate: FAIL\*\*: 1 of 2 probed routes fail, 1 skipped/);
    expect(line).toContain("/tasks (warm p50 700 > 600 ms)");
    expect(summaryLine(judgeRun(run.slice(0, 1), null), { compared: true })).toMatch(
      /^\*\*Speed gate: PASS\*\*: all 1 probed routes pass .*> 10 % or > 100 ms/,
    );
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
