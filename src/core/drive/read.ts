import "server-only";

import { createServerSupabase } from "@/core/db/server";

import { type DriveStatus, toDriveStatus } from "./status";

/**
 * The Owner's view of the connection (`drive_status()`, `drive.manage`): state, account,
 * space and the last error. Never a token. Read under the Owner's session; the database
 * refuses anyone else.
 */
export async function readDriveStatus(): Promise<DriveStatus> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("drive_status");
  if (error) throw error;
  return toDriveStatus(data);
}
