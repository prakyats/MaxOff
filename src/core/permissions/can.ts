import { type MemberRole, type PermissionKey, ROLE_GRANTS } from "./keys";

/**
 * Does this role hold the key (or any of the keys)? Mirrors `app.has_permission()` for the UI
 * and the early server-side check; RLS and the transition functions remain the real gate.
 * Scope ("only *their* clients") is never decided here: that is a row question for the database.
 */
export function can(
  role: MemberRole,
  permission: PermissionKey | readonly PermissionKey[],
): boolean {
  const granted = ROLE_GRANTS[role];
  if (typeof permission === "string") return granted.includes(permission);
  return permission.some((key) => granted.includes(key));
}
