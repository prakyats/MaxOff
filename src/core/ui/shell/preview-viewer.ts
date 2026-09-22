import "server-only";

import { cookies } from "next/headers";

import { PREVIEW_ROLE_COOKIE, resolvePreviewRole } from "./preview-role";
import type { ShellRole, ShellViewer } from "./viewer";

/**
 * DEVELOPMENT-ONLY SHIM. Fakes a signed-in member so the shell can be previewed before
 * `core/auth` exists. Task 1.2 replaces every caller with `getCurrentMember()` and deletes
 * this file, `preview-role.ts`, `preview-role-actions.ts` and `preview-role-switcher.tsx`.
 * In production it always returns `null` (asserted by `preview-role.test.ts`).
 */
const PREVIEW_VIEWERS: Record<ShellRole, ShellViewer> = {
  ceo: { role: "ceo", name: "Preview CEO", jobTitle: null },
  admin: { role: "admin", name: "Preview Admin", jobTitle: "Account Manager" },
  staff: { role: "staff", name: "Preview Staff", jobTitle: "Video Editor" },
};

export async function getPreviewViewer(): Promise<ShellViewer | null> {
  const cookieStore = await cookies();
  const role = resolvePreviewRole(
    cookieStore.get(PREVIEW_ROLE_COOKIE)?.value,
    process.env.NODE_ENV,
  );
  return role ? PREVIEW_VIEWERS[role] : null;
}
