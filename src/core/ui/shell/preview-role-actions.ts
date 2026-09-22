"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { homeFor } from "./nav";
import { isPreviewEnvironment, PREVIEW_ROLE_COOKIE } from "./preview-role";
import { isShellRole } from "./viewer";

/**
 * DEVELOPMENT-ONLY SHIM (see `preview-viewer.ts`). Switches the previewed role.
 * Refuses to do anything in production. Deleted in task 1.2.
 */
export async function setPreviewRole(role: string): Promise<void> {
  if (!isPreviewEnvironment(process.env.NODE_ENV) || !isShellRole(role)) return;
  const cookieStore = await cookies();
  cookieStore.set(PREVIEW_ROLE_COOKIE, role, { path: "/", sameSite: "lax", httpOnly: true });
  redirect(homeFor(role));
}
