import { isShellRole, type ShellRole } from "./viewer";

/** Cookie the development-only role switcher writes. Deleted with this file in task 1.2. */
export const PREVIEW_ROLE_COOKIE = "maxoff-preview-role";

/**
 * Resolves the role the shell should preview. Pure so it can be tested.
 * Active only in `development` and `test` (an allow-list, so an unset or unusual NODE_ENV
 * can never turn it on). In development a missing or invalid cookie previews the CEO, the
 * richest layout.
 */
export function isPreviewEnvironment(nodeEnv: string | undefined): boolean {
  return nodeEnv === "development" || nodeEnv === "test";
}

export function resolvePreviewRole(
  cookieValue: string | undefined,
  nodeEnv: string | undefined,
): ShellRole | null {
  if (!isPreviewEnvironment(nodeEnv)) return null;
  return isShellRole(cookieValue) ? cookieValue : "ceo";
}
