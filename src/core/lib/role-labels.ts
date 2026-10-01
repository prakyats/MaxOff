import type { Enums } from "@/core/db";

/**
 * The roles as people read them, in the one place every screen takes them from. The third role
 * is shown as **"Crew"** (owner decision 2026-09-30); underneath it is still `staff`: the
 * `member_role` value, the permission grants and RLS are unchanged (CLAUDE.md invariant 1).
 * "Crew" is also its own plural ("Admins and Crew"); one person is "a Crew member".
 * `tests/role-label-sweep.test.ts` fails on a "Staff" someone could read, and on a "Crew" spelled
 * out anywhere but here.
 */
export const ROLE_LABELS: Record<Enums<"member_role">, string> = {
  owner: "Owner",
  admin: "Admin",
  staff: "Crew",
};
