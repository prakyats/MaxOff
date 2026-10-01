import { describe, expect, it } from "vitest";

import { MEMBER_ROLES } from "@/core/permissions";

import { ROLE_LABELS } from "./role-labels";

describe("ROLE_LABELS", () => {
  it('shows the third role as "Crew" while its value stays `staff`', () => {
    expect(ROLE_LABELS.staff).toBe("Crew");
    expect(MEMBER_ROLES).toContain("staff");
  });

  it("names exactly the three roles, each differently (invariant 1)", () => {
    expect(Object.keys(ROLE_LABELS).sort()).toEqual([...MEMBER_ROLES].sort());
    expect(ROLE_LABELS).toEqual({ owner: "Owner", admin: "Admin", staff: "Crew" });
    expect(new Set(Object.values(ROLE_LABELS)).size).toBe(MEMBER_ROLES.length);
  });
});
