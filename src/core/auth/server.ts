import "server-only";

import { getPreviewViewer } from "@/core/ui/shell/preview-viewer";

import type { CurrentMember } from "./types";

/**
 * The signed-in member, or `null`. This is the seam every page and guard uses
 * (`requirePermission`, the app layout, the landing redirect), so task 1.2 replaces only this
 * body: read the Supabase session, load the member row (RLS: own row; a deactivated or invited
 * member has none, so access ends immediately) and set `Sentry.setUser({ id })`.
 *
 * Until then it delegates to the development-only preview cookie, which is `null` in every
 * production build (`preview-role.test.ts`, `e2e/production.spec.ts`).
 */
export async function getCurrentMember(): Promise<CurrentMember | null> {
  return getPreviewViewer();
}

export type { CurrentMember } from "./types";
