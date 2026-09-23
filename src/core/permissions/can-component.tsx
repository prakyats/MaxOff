import type { ReactNode } from "react";

import { can } from "./can";
import type { MemberRole, PermissionKey } from "./keys";

/**
 * Renders its children only when `role` holds the permission (or any of the permissions).
 * No hooks, so it works in Server and Client Components alike. The UI only hides controls:
 * the action's `assertPermission()` and RLS are the gates (PERMISSIONS.md).
 */
export function Can({
  role,
  permission,
  children,
  fallback = null,
}: {
  role: MemberRole;
  permission: PermissionKey | readonly PermissionKey[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return can(role, permission) ? children : fallback;
}
