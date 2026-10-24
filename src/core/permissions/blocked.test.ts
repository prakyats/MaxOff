import { describe, expect, it } from "vitest";

import { blockedKeysFrom, blockedLine } from "./blocked";

describe("blockedLine (V5b-D, the approved pull-in sample)", () => {
  it("names the area and who it is for, from the permission table", () => {
    expect(blockedLine(["clients.manage", "clients.edit_assigned"])).toBe(
      "Clients are for the Owner and Admins",
    );
    expect(blockedLine(["settings.manage"])).toBe("Settings are for the Owner");
    expect(blockedLine(["team.view"])).toBe("The team list is for the Owner and Admins");
    expect(blockedLine(["attendance.view_all"])).toBe("Everyone's attendance is for the Owner");
  });

  it("names the Crew by its label, never staff", () => {
    const line = blockedLine(["attendance.self"]);
    expect(line).toMatch(/^Attendance and leave are for /);
    expect(line).not.toMatch(/staff/i);
  });

  it("says nothing it cannot back", () => {
    expect(blockedLine([])).toBeNull();
  });
});

describe("blockedKeysFrom", () => {
  it("reads known keys only", () => {
    expect(blockedKeysFrom("clients.manage,clients.edit_assigned")).toEqual([
      "clients.manage",
      "clients.edit_assigned",
    ]);
    expect(blockedKeysFrom("nope,settings.manage")).toEqual(["settings.manage"]);
    expect(blockedKeysFrom(["reports.all"])).toEqual(["reports.all"]);
    expect(blockedKeysFrom(undefined)).toEqual([]);
  });
});
