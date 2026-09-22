import { describe, expect, it } from "vitest";

import { can } from "./can";
import { isPermissionKey, MEMBER_ROLES, PERMISSION_KEYS, ROLE_GRANTS } from "./keys";

describe("PERMISSION_KEYS", () => {
  it("are unique and shaped like area.verb", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    for (const key of PERMISSION_KEYS) expect(key).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });

  it("isPermissionKey narrows", () => {
    expect(isPermissionKey("tasks.work")).toBe(true);
    expect(isPermissionKey("tasks.hack")).toBe(false);
    expect(isPermissionKey(42)).toBe(false);
  });
});

describe("ROLE_GRANTS", () => {
  it("covers every role with known keys only, no duplicates", () => {
    for (const role of MEMBER_ROLES) {
      const grants = ROLE_GRANTS[role];
      expect(new Set(grants).size).toBe(grants.length);
      for (const key of grants) expect(isPermissionKey(key)).toBe(true);
    }
  });

  it("every key is granted to at least one role", () => {
    const granted = new Set(MEMBER_ROLES.flatMap((role) => ROLE_GRANTS[role]));
    expect([...granted].sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it("keeps the business invariants of CLAUDE.md", () => {
    // Money and final approvals are the Owner's alone.
    for (const key of [
      "finance.view",
      "finance.edit",
      "tasks.approve_final",
      "items.approve",
      "attendance.decide",
      "months.close",
      "records.hard_delete",
    ] as const) {
      expect(can("owner", key)).toBe(true);
      expect(can("admin", key)).toBe(false);
      expect(can("staff", key)).toBe(false);
    }
    // The Admin step belongs to Admins only; the Owner does not mark attendance.
    expect(ROLE_GRANTS.owner).not.toContain("tasks.approve_admin");
    expect(ROLE_GRANTS.owner).not.toContain("attendance.self");
    // Staff never touch clients, people or reports.
    for (const key of ROLE_GRANTS.staff) {
      expect(key.startsWith("clients.")).toBe(false);
      expect(key.startsWith("team.")).toBe(false);
      expect(key.startsWith("reports.")).toBe(false);
    }
  });
});

describe("can", () => {
  it("checks a single key", () => {
    expect(can("staff", "tasks.work")).toBe(true);
    expect(can("staff", "tasks.create")).toBe(false);
  });

  it("accepts any of several keys", () => {
    expect(can("admin", ["tasks.approve_final", "tasks.approve_admin"])).toBe(true);
    expect(can("staff", ["tasks.approve_final", "tasks.approve_admin"])).toBe(false);
    expect(can("owner", [])).toBe(false);
  });
});
