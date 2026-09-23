import type { Enums } from "@/core/db";

/** DATA-MODEL §0 `member_role`. Exactly three roles (ADR-0004); job titles are data. */
export type MemberRole = Enums<"member_role">;

export const MEMBER_ROLES = ["owner", "admin", "staff"] as const satisfies readonly MemberRole[];

/**
 * The permission keys of PERMISSIONS.md §1, in the table's order. The database seed in
 * `role_permissions` is the gate (`app.has_permission()`); this registry types the keys and
 * lets the UI decide early. `tests/permissions-drift.test.ts` proves the three stay identical.
 */
export const PERMISSION_KEYS = [
  "team.manage",
  "team.view",
  "availability.view",
  "settings.manage",
  "drive.manage",
  "drive.view_status",
  "notifications.reachability",
  "lists.manage",
  "templates.manage",
  "clients.manage",
  "clients.edit_assigned",
  "clients.private_notes",
  "projects.manage",
  "items.tick",
  "items.approve",
  "cycles.carry_decide",
  "projects.complete",
  "tasks.create",
  "tasks.approve_admin",
  "tasks.approve_final",
  "tasks.work",
  "task_requests.create",
  "task_requests.decide",
  "attendance.self",
  "attendance.decide",
  "attendance.view_all",
  "finance.view",
  "finance.edit",
  "reports.all",
  "reports.scoped",
  "months.close",
  "activity.view_all",
  "records.hard_delete",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && (PERMISSION_KEYS as readonly string[]).includes(value);
}

/** PERMISSIONS §1 default grants per role: the mirror of the `role_permissions` seed. */
export const ROLE_GRANTS: Record<MemberRole, readonly PermissionKey[]> = {
  owner: [
    "team.manage",
    "team.view",
    "availability.view",
    "settings.manage",
    "drive.manage",
    "drive.view_status",
    "notifications.reachability",
    "lists.manage",
    "templates.manage",
    "clients.manage",
    "clients.edit_assigned",
    "clients.private_notes",
    "projects.manage",
    "items.tick",
    "items.approve",
    "cycles.carry_decide",
    "projects.complete",
    "tasks.create",
    "tasks.approve_final",
    "tasks.work",
    "task_requests.decide",
    "attendance.decide",
    "attendance.view_all",
    "finance.view",
    "finance.edit",
    "reports.all",
    "months.close",
    "activity.view_all",
    "records.hard_delete",
  ],
  admin: [
    "team.view",
    "availability.view",
    "drive.view_status",
    "notifications.reachability",
    "lists.manage",
    "templates.manage",
    "clients.edit_assigned",
    "projects.manage",
    "items.tick",
    "tasks.create",
    "tasks.approve_admin",
    "tasks.work",
    "task_requests.create",
    "task_requests.decide",
    "attendance.self",
    "reports.scoped",
  ],
  staff: ["drive.view_status", "tasks.work", "task_requests.create", "attendance.self"],
};
