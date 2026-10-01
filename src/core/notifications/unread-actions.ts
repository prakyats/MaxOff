"use server";

import { getCurrentMember } from "@/core/auth/server";
import { action, AppError, ok, type Result } from "@/core/errors";

import { readUnread } from "./inbox";
import type { ServerUnread } from "./read-receipts";

/**
 * The bell's count alone, for the live bell to confirm the device's own reads (owner decision
 * 2026-10-01): the member's Realtime read receipts ask for it instead of re-reading the page.
 * Read only: nothing is revalidated, so the answer never re-renders the screen.
 */
export const readUnreadCount = action(async (): Promise<Result<ServerUnread>> => {
  const member = await getCurrentMember();
  if (!member) throw new AppError("UNAUTHENTICATED");
  return ok(await readUnread());
});
