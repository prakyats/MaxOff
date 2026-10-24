import { avatarInitials } from "@/core/lib/avatar";

/**
 * What the shell needs to know about the signed-in person.
 * `role` mirrors DATA-MODEL §0 `member_role`. When `core/auth` lands (1.2) it produces this
 * from the real session; until then `preview-viewer.ts` fakes it in development only.
 */
export const SHELL_ROLES = ["owner", "admin", "staff"] as const;
export type ShellRole = (typeof SHELL_ROLES)[number];

export function isShellRole(value: unknown): value is ShellRole {
  return typeof value === "string" && (SHELL_ROLES as readonly string[]).includes(value);
}

export type ShellViewer = {
  role: ShellRole;
  name: string;
  /** Job titles are data (PRODUCT §3), shown for context only. */
  jobTitle: string | null;
  /** The member's photo (3.3); the menu shows initials without one. */
  avatarFileId?: string | null;
};

/** The initials a photo falls back to: the shared avatar's rule (`core/lib/avatar`). */
export function initialsOf(name: string): string {
  return avatarInitials(name);
}
