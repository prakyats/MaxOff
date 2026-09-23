/**
 * core/permissions: the key registry and `can()` (PERMISSIONS §1, ADR-0004).
 *
 * `requirePermission()` (pages: redirects) and `assertPermission()` (actions: throws
 * `AppError`) live in `@/core/permissions/server` because they are `server-only`.
 */
export { can } from "./can";
export {
  isPermissionKey,
  MEMBER_ROLES,
  type MemberRole,
  PERMISSION_KEYS,
  type PermissionKey,
  ROLE_GRANTS,
} from "./keys";
export { Can } from "./can-component";
