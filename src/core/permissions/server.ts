import "server-only";

import { notFound, redirect } from "next/navigation";

import { type CurrentMember, getCurrentMember } from "@/core/auth/server";
import { AppError } from "@/core/errors";

import { can } from "./can";
import type { PermissionKey } from "./keys";

/**
 * The early, friendly permission check for pages (ARCHITECTURE §4.2; actions use
 * `assertPermission`). With no
 * signed-in member the page does not exist (task 1.2 turns this into a redirect to /login);
 * a member without the key (or any of the keys) is sent to /forbidden. Returns the member so the
 * page can render for them. RLS is the real gate: this only avoids showing a screen that would
 * come back empty.
 */
export async function requirePermission(
  permission: PermissionKey | readonly PermissionKey[],
): Promise<CurrentMember> {
  const member = await getCurrentMember();
  if (!member) notFound();
  if (!can(member.role, permission)) redirect("/forbidden");
  return member;
}

/**
 * The same check for server actions, which must answer with a `Result` (ARCHITECTURE §4.3)
 * rather than navigate: throws `AppError` (`UNAUTHENTICATED` / `FORBIDDEN`) for `action()`
 * to map. Returns the member so the action can use its id and role.
 */
export async function assertPermission(
  permission: PermissionKey | readonly PermissionKey[],
): Promise<CurrentMember> {
  const member = await getCurrentMember();
  if (!member) throw new AppError("UNAUTHENTICATED");
  if (!can(member.role, permission)) throw new AppError("FORBIDDEN");
  return member;
}
