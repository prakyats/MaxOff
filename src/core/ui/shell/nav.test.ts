import { describe, expect, it } from "vitest";

import { homeFor, isActivePath, NAV_BY_ROLE, navFor, settingsSectionsFor } from "./nav";
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
