import type { MemberRole } from "@/core/permissions";

/**
 * What a page knows about the signed-in person. Task 1.2 adds `id` and `email` from the
 * member row; the shell (`ShellViewer`) needs only this subset.
 */
export type CurrentMember = {
  role: MemberRole;
  name: string;
  /** Job titles are data (PRODUCT §3), shown for context only. */
  jobTitle: string | null;
};
