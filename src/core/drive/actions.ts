"use server";

import { revalidatePath } from "next/cache";

import { createServerSupabase } from "@/core/db/server";
import { action, ok, type Result } from "@/core/errors";
import { assertPermission } from "@/core/permissions/server";

import { DRIVE_SETTINGS_PATH, revokeGrant, storedGrant } from "./connect";

/**
 * Settings → Google Drive → Disconnect (v4.0, `drive.manage`, Owner only): `drive_disconnect()`
 * drops the tokens and keeps the history (audited by the database), then Google is asked to
 * forget MaxOff's access (best effort). Nothing in Drive is moved or deleted. A database error is
 * thrown as it came: `action()` maps it (UNAUTHENTICATED, FORBIDDEN).
 */
export const disconnectDrive = action(async (): Promise<Result<null>> => {
  const member = await assertPermission("drive.manage");
  const grant = await storedGrant(member.id);
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("drive_disconnect");
  if (error) throw error;
  await revokeGrant(grant);
  revalidatePath(DRIVE_SETTINGS_PATH);
  return ok(null);
});
