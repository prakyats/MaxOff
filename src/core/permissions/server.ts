import "server-only";

import { redirect } from "next/navigation";

import { type CurrentMember, getCurrentMember, requireMember } from "@/core/auth/server";
import { AppError } from "@/core/errors";

import { can } from "./can";
import type { PermissionKey } from "./keys";

/**
 * The early, friendly permission check for pages (ARCHITECTURE §4.2; actions use
 * `assertPermission`). With no signed-in member the page sends the visitor to /login
 * (`requireMember()`); a member without the key (or any of the keys) is sent to /forbidden,
 * with the keys (`?for=`), so the screen names what was blocked ("Clients are for the Owner and
 * Admins", `blockedLine`).
 * Returns the member so the page can render for them. RLS is the real gate: this only avoids
 * showing a screen that would come back empty.
 */
export async function requirePermission(
  permission: PermissionKey | readonly PermissionKey[],
  /**
   * Where a role without the key goes instead of /forbidden, when the screen has a counterpart
   * for it (v7.5 G5, advisor 2026-11-26: the Owner has no day of his own, so an old My Day or
   * Leave link takes him to his own screen, not a dead end). `redirect()` in a page replaces the
   * entry, so back never bounces. Anyone else without the key still gets /forbidden.
   */
  instead?: Partial<Record<CurrentMember["role"], string>>,
): Promise<CurrentMember> {
  const member = await requireMember();
  if (!can(member.role, permission)) {
    const elsewhere = instead?.[member.role];
    if (elsewhere) redirect(elsewhere);
    // The keys travel with the bounce, so No access can name what was blocked (V5b-D).
    const keys: readonly PermissionKey[] =
      typeof permission === "string" ? [permission] : permission;
    redirect(`/forbidden?for=${keys.join(",")}`);
  }
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

/**
 * The Owner-only acts PERMISSIONS names by role rather than by key (v1.8 V5a 6b: Delete of a
 * template, a stage preset or a holiday). Throws `AppError` (`UNAUTHENTICATED` / `FORBIDDEN`) as
 * `assertPermission` does; the database checks `app.is_owner()` again.
 */
export async function assertOwner(): Promise<CurrentMember> {
  const member = await getCurrentMember();
  if (!member) throw new AppError("UNAUTHENTICATED");
  if (member.role !== "owner") throw new AppError("FORBIDDEN", "Only the Owner can delete this.");
  return member;
}
