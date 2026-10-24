import { ROLE_LABELS } from "@/core/lib/role-labels";

import { can } from "./can";
import { isPermissionKey, MEMBER_ROLES, type MemberRole, type PermissionKey } from "./keys";

/**
 * What the No access screen says was blocked (FINAL 7, the approved pull-in sample, V5b-D):
 * "Clients are for the Owner and Admins". `requirePermission` sends the keys the page asked for
 * (`/forbidden?for=clients.manage,clients.edit_assigned`); the area is the first key's, and who it
 * is for is worked out from the permission table itself (`can`), so it never drifts from
 * PERMISSIONS.md. Pure.
 */

/** The area a key opens, as a sentence's subject, with its verb. */
const AREAS: Partial<Record<PermissionKey, string>> = {
  "team.view": "The team list is",
  "team.manage": "Managing the team is",
  "settings.manage": "Settings are",
  "lists.manage": "Settings are",
  "drive.manage": "Google Drive settings are",
  "templates.manage": "Templates are",
  "notifications.reachability": "Who can be reached is",
  "clients.create": "Clients are",
  "clients.manage": "Clients are",
  "clients.edit_assigned": "Clients are",
  "projects.manage": "Client projects are",
  "items.tick": "Client work is",
  "items.approve": "Client work is",
  "cycles.carry_decide": "Client work is",
  "tasks.work": "Tasks are",
  "task_requests.create": "Suggested tasks are",
  "task_requests.decide": "Suggested tasks are",
  "tasks.approve_admin": "Approvals are",
  "tasks.approve_final": "Approvals are",
  "attendance.decide": "Approvals are",
  "attendance.self": "Attendance and leave are",
  "attendance.view_all": "Everyone's attendance is",
  "expenses.decide": "Expense decisions are",
  "reports.all": "Reports are",
  "reports.scoped": "Reports are",
};

/** A role as the sentence names it: "the Owner", "Admins", "the Crew" (`ROLE_LABELS`). */
function roleWords(role: MemberRole): string {
  if (role === "admin") return `${ROLE_LABELS.admin}s`;
  return `the ${ROLE_LABELS[role]}`;
}

function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** The keys from the address (`?for=a,b`): known keys only, anything else dropped. */
export function blockedKeysFrom(value: unknown): PermissionKey[] {
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== "string") return [];
  return text.split(",").filter(isPermissionKey);
}

/**
 * "Clients are for the Owner and Admins": the first key's area and every role any of the keys
 * opens it to. Null when the address names no known key (the screen then says it plainly).
 */
export function blockedLine(keys: readonly PermissionKey[]): string | null {
  const first = keys[0];
  if (!first) return null;
  const who = MEMBER_ROLES.filter((role) => can(role, keys)).map(roleWords);
  if (who.length === 0) return null;
  return `${AREAS[first] ?? "This page is"} for ${joinAnd(who)}`;
}
