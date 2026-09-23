import { describe, expect, it } from "vitest";

import {
  alertsInBottomNav,
  homeFor,
  isActivePath,
  MOBILE_MORE,
  MOBILE_PRIMARY,
  mobileNavFor,
  NAV_BY_ROLE,
  navFor,
  PROFILE_NAV_ITEM,
  settingsSectionsFor,
  totalBadge,
} from "./nav";
import { SHELL_ROLES, type ShellRole } from "./viewer";

const keys = (role: ShellRole) => navFor(role).map((item) => item.key);
const permissions = (role: ShellRole) => navFor(role).map((item) => item.permission);

describe("navFor", () => {
  it("gives the Owner the full navigation", () => {
    expect(keys("owner")).toEqual([
      "today",
      "approvals",
      "clients",
      "tasks",
      "calendar",
      "people",
      "reports",
      "settings",
    ]);
  });

  it("gives Admins the same screens under their own permissions", () => {
    expect(keys("admin")).toEqual(keys("owner"));
    expect(permissions("admin")).toContain("tasks.approve_admin");
    expect(permissions("admin")).toContain("clients.edit_assigned");
    expect(permissions("admin")).toContain("reports.scoped");
    expect(permissions("admin")).toContain("lists.manage");
  });

  it("gives Staff exactly My Day, Tasks, Calendar, Alerts and Me (PRODUCT §4.7)", () => {
    expect(keys("staff")).toEqual(["my-day", "tasks", "calendar", "alerts", "me"]);
    expect(navFor("staff").map((item) => item.label)).toEqual([
      "My Day",
      "Tasks",
      "Calendar",
      "Alerts",
      "Me",
    ]);
  });

  it("never shows Staff clients, people, approvals, reports or settings", () => {
    for (const forbidden of ["clients", "people", "approvals", "reports", "settings"]) {
      expect(keys("staff")).not.toContain(forbidden);
    }
    const hrefs = navFor("staff").map((item) => item.href);
    for (const href of ["/clients", "/people", "/approvals", "/reports", "/settings"]) {
      expect(hrefs).not.toContain(href);
    }
  });

  it("keeps Owner-only permissions out of Admin and Staff navigation", () => {
    const ceoOnly = [
      "settings.manage",
      "team.manage",
      "drive.manage",
      "clients.manage",
      "tasks.approve_final",
      "reports.all",
    ];
    for (const role of ["admin", "staff"] as const) {
      for (const key of ceoOnly) expect(permissions(role)).not.toContain(key);
    }
  });

  it("never links to money for anyone: revenue is a panel inside Owner screens (ADR-0007)", () => {
    const moneyWords = /finance|revenue|billing|money|invoice|payment/i;
    for (const role of SHELL_ROLES) {
      for (const item of navFor(role)) {
        expect(item.href).not.toMatch(moneyWords);
        expect(item.label).not.toMatch(moneyWords);
        expect(item.permission ?? "").not.toMatch(moneyWords);
      }
    }
  });

  it("uses unique keys and hrefs within a role", () => {
    for (const role of SHELL_ROLES) {
      const items = NAV_BY_ROLE[role];
      expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
      expect(new Set(items.map((i) => i.href)).size).toBe(items.length);
    }
  });
});

describe("mobileNavFor", () => {
  it("gives each role the bottom bar the owner decided on (2026-09-23)", () => {
    // The owner's stated priority order; Clients is not daily, so it is not in the bar.
    for (const role of ["owner", "admin"] as const) {
      expect(mobileNavFor(role).primary.map((i) => i.label)).toEqual([
        "Today",
        "Approvals",
        "Tasks",
        "Calendar",
      ]);
    }
    expect(mobileNavFor("staff").primary.map((i) => i.label)).toEqual([
      "My Day",
      "Tasks",
      "Calendar",
      "Alerts",
      "Me",
    ]);
  });

  it("puts everything else in More in the same priority order, and Staff get no More", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(mobileNavFor(role).more.map((i) => i.key)).toEqual([
        "reports",
        "clients",
        "people",
        "settings",
      ]);
    }
    expect(mobileNavFor("staff").more).toEqual([]);
  });

  it("keeps Owner and Admin as separate entries even while they match", () => {
    // They will diverge again once Approvals and Reports carry different weight for each role.
    expect(MOBILE_PRIMARY.owner).not.toBe(MOBILE_PRIMARY.admin);
    expect(MOBILE_MORE.owner).not.toBe(MOBILE_MORE.admin);
  });

  it("never drops or duplicates a destination: primary + More is the whole navigation", () => {
    for (const role of SHELL_ROLES) {
      const { primary, more } = mobileNavFor(role);
      const keys = [...primary, ...more].map((item) => item.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect([...keys].sort()).toEqual([...navFor(role).map((i) => i.key)].sort());
    }
  });

  it("keeps the bar to five cells, counting More", () => {
    for (const role of SHELL_ROLES) {
      const { primary, more } = mobileNavFor(role);
      expect(primary.length + (more.length > 0 ? 1 : 0)).toBeLessThanOrEqual(5);
    }
  });

  it("names only keys the role actually has", () => {
    for (const role of SHELL_ROLES) {
      const available = navFor(role).map((item) => item.key);
      for (const key of [...MOBILE_PRIMARY[role], ...MOBILE_MORE[role]]) {
        expect(available).toContain(key);
      }
    }
  });

  it("the two arrays together are exactly the role's navigation, so nothing is lost", () => {
    for (const role of SHELL_ROLES) {
      const split = [...MOBILE_PRIMARY[role], ...MOBILE_MORE[role]];
      expect(new Set(split).size).toBe(split.length);
      expect([...split].sort()).toEqual([...navFor(role).map((i) => i.key)].sort());
    }
  });

  it("never duplicates the profile: Staff have it in the bar, the others in More", () => {
    expect(mobileNavFor("staff").primary.map((i) => i.href)).toContain(PROFILE_NAV_ITEM.href);
    for (const role of ["owner", "admin"] as const) {
      const { primary, more } = mobileNavFor(role);
      const hrefs = [...primary, ...more].map((item) => item.href);
      expect(hrefs).not.toContain(PROFILE_NAV_ITEM.href);
    }
  });

  it("adds up what is hidden behind More, so a count never disappears into the sheet", () => {
    const more = mobileNavFor("owner").more;
    expect(totalBadge(more)).toBe(0);
    expect(
      totalBadge([
        { ...more[0]!, badge: 3 },
        { ...more[1]!, badge: 2 },
      ]),
    ).toBe(5);
    // A count nothing has set, and a nonsense negative, are both just "nothing waiting".
    expect(totalBadge([{ ...more[0]! }, { ...more[1]!, badge: -4 }])).toBe(0);
  });

  it("no destination ships with a badge: 2.4 and 5.1 set them from real data", () => {
    for (const role of SHELL_ROLES) {
      for (const item of navFor(role)) expect(item.badge).toBeUndefined();
    }
  });

  it("puts the bell in the title bar for exactly the roles whose bar has no Alerts", () => {
    expect(alertsInBottomNav("staff")).toBe(true);
    expect(alertsInBottomNav("owner")).toBe(false);
    expect(alertsInBottomNav("admin")).toBe(false);
  });

  it("never reaches money on a phone either (ADR-0007)", () => {
    const moneyWords = /finance|revenue|billing|money|invoice|payment/i;
    for (const role of SHELL_ROLES) {
      for (const item of [...mobileNavFor(role).primary, ...mobileNavFor(role).more]) {
        expect(item.href).not.toMatch(moneyWords);
        expect(item.label).not.toMatch(moneyWords);
      }
    }
  });
});

describe("settingsSectionsFor", () => {
  it("gives the Owner every section", () => {
    expect(settingsSectionsFor("owner").map((s) => s.key)).toEqual([
      "company",
      "days-off",
      "thresholds",
      "job-titles",
      "task-types",
      "stage-presets",
      "custom-fields",
      "templates",
      "drive",
    ]);
  });

  it("gives Admins only lists, templates and custom fields", () => {
    const admin = settingsSectionsFor("admin");
    expect(admin.map((s) => s.key)).toEqual([
      "job-titles",
      "task-types",
      "stage-presets",
      "custom-fields",
      "templates",
    ]);
    for (const ceoOnly of ["company", "days-off", "thresholds", "drive"]) {
      expect(admin.map((s) => s.key)).not.toContain(ceoOnly);
    }
    expect(admin.map((s) => s.permission)).not.toContain("settings.manage");
    expect(admin.map((s) => s.permission)).not.toContain("drive.manage");
    expect(admin.map((s) => s.permission)).not.toContain("team.manage");
  });

  it("gives Staff nothing", () => {
    expect(settingsSectionsFor("staff")).toEqual([]);
  });
});

describe("homeFor / isActivePath", () => {
  it("sends Staff to My Day and everyone else to Today", () => {
    expect(homeFor("staff")).toBe("/my-day");
    expect(homeFor("admin")).toBe("/today");
    expect(homeFor("owner")).toBe("/today");
  });

  it("marks a route and its children active, not look-alike prefixes", () => {
    expect(isActivePath("/tasks", "/tasks")).toBe(true);
    expect(isActivePath("/tasks/123", "/tasks")).toBe(true);
    expect(isActivePath("/tasks-archive", "/tasks")).toBe(false);
    expect(isActivePath("/today", "/tasks")).toBe(false);
  });
});
