import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { routeKey } from "./route-key";

const PERSON = "/people/20000000-0000-4000-8000-000000000001";

describe("routeKey (ARCHITECTURE §14.2 j)", () => {
  it("gives the tabs of one screen one key", () => {
    expect(routeKey("/leave")).toBe("/leave");
    expect(routeKey("/leave/attendance")).toBe("/leave");
    expect(routeKey(PERSON)).toBe(PERSON);
    expect(routeKey(`${PERSON}/attendance`)).toBe(PERSON);
  });

  it("gives a drill-down its own key, so it can slide", () => {
    expect(routeKey("/people")).not.toBe(routeKey(PERSON));
    expect(routeKey("/today")).not.toBe(routeKey(PERSON));
    expect(routeKey("/settings")).not.toBe(routeKey("/settings/company"));
  });

  it("leaves every other path as it is", () => {
    for (const path of ["/today", "/approvals", "/settings/job-titles", "/leave/other"]) {
      expect(routeKey(path)).toBe(path);
    }
  });

  it("covers every tab bar built from ViewLinks to sibling routes", () => {
    // The two tab bars that switch routes today; a new one must join `TAB_ROUTES`.
    const leaveTabs = readFileSync("src/app/(app)/leave/leave-tabs.tsx", "utf8");
    const personNav = readFileSync("src/app/(app)/people/[id]/person-nav.tsx", "utf8");
    expect(leaveTabs).toContain('"/leave/attendance"');
    expect(personNav).toContain("/attendance`");
  });
});
