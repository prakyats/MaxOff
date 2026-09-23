import type { MemberRole } from "@/core/permissions";

/**
 * What a page knows about the signed-in person: the active member row behind the Supabase
 * session (`getCurrentMember()` in `server.ts`). The shell (`ShellViewer`) uses the
 * `role` / `name` / `jobTitle` subset.
 */
export type CurrentMember = {
  /** `members.id` = `auth.users.id`. The only thing Sentry ever learns about a person. */
  id: string;
  /** The login identity; Owner-only elsewhere (PERMISSIONS §2), shown to the member on /me. */
  email: string;
  role: MemberRole;
  name: string;
  /** The job title's name (`list_items`, PRODUCT §3): context only, never a permission. */
  jobTitle: string | null;
};
