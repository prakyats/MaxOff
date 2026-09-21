/**
 * What the shell needs to know about the signed-in person.
 * `role` mirrors DATA-MODEL §0 `member_role`. When `core/auth` lands (1.2) it produces this
 * from the real session; until then `preview-viewer.ts` fakes it in development only.
 */
export const SHELL_ROLES = ["ceo", "admin", "staff"] as const;
export type ShellRole = (typeof SHELL_ROLES)[number];

export function isShellRole(value: unknown): value is ShellRole {
  return typeof value === "string" && (SHELL_ROLES as readonly string[]).includes(value);
}

export type ShellViewer = {
  role: ShellRole;
  name: string;
  /** Job titles are data (PRODUCT §3), shown for context only. */
  jobTitle: string | null;
};

export const ROLE_LABELS: Record<ShellRole, string> = {
  ceo: "CEO",
  admin: "Admin",
  staff: "Staff",
};

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}
