import type { MemberRole } from "@/core/permissions";

/**
 * What a page knows about the signed-in person: the active member row behind the Supabase
 * session (`getCurrentMember()` in `server.ts`). The shell (`ShellViewer`) uses the
 * `role` / `name` / `jobTitle` subset.
 */
export type CurrentMember = {
  /** `members.id` = `auth.users.id`. The only thing Sentry ever learns about a person. */
  id: string;
  /**
   * The login identity; Owner-only elsewhere (PERMISSIONS §2), shown to the member on /me. The
   * column is nullable since 4A (a freelancer has no login, ADR-0013), so the type says so; a
   * session always belongs to an employee, whose row carries one.
   */
  email: string | null;
  role: MemberRole;
  name: string;
  /** The job title's name (`list_items`, PRODUCT §3): context only, never a permission. */
  jobTitle: string | null;
  /** The member's photo (`files`, task 3.3), shown through `/api/files/<id>`; null = initials. */
  avatarFileId: string | null;
};
