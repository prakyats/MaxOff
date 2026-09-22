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
  /** Job titles are data (PRODUCT §3), shown for context only. Filled from 1.3. */
  jobTitle: string | null;
};
