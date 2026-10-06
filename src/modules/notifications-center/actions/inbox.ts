"use server";

import { z } from "zod";

import { getCurrentMember } from "@/core/auth/server";
import { action, AppError, ok, type Result } from "@/core/errors";
import { markOneRead, rpcMarkAllRead } from "@/core/notifications/inbox";
import { systemClock } from "@/core/time";

/**
 * The member's read receipts by a tap (task 5.1, kickoff 5 decision 4): zod → the member → the
 * write → `Result`. Opening a record reads its rows in the background, which is not an action
 * (`POST /api/notifications/read-record`, ARCHITECTURE §4.4). Every member has notifications of their own, so no permission key beyond being an
 * active member; RLS keeps each to their own rows. A read is view state, not audited
 * (DATA-MODEL §9). **Nothing is revalidated** (owner decision 2026-10-01): an answer that
 * re-renders the page reloads it when it lands after a view switch, so the device takes the rows
 * off the bell's count itself (`core/notifications/read-receipts.ts`) and the server's next count
 * confirms it. Each answer says how many rows it marked and when (`writtenAt`, server ms).
 */
async function requireCurrentMember() {
  const member = await getCurrentMember();
  if (!member) throw new AppError("UNAUTHENTICATED");
  return member;
}

export interface ReadAnswer {
  marked: number;
  /** The server's clock just after the write: a count made after it holds the read. */
  writtenAt: number;
}

function answer(marked: number): Result<ReadAnswer> {
  return ok({ marked, writtenAt: systemClock().getTime() });
}

const idSchema = z.object({ id: z.uuid() });

/** A row with nothing to open, tapped: it is read (a row with a link is read by `/open`). */
export const markNotificationRead = action(
  async (input: z.input<typeof idSchema>): Promise<Result<ReadAnswer>> => {
    const { id } = idSchema.parse(input);
    await requireCurrentMember();
    return answer((await markOneRead(id))?.marked ? 1 : 0);
  },
);

/** "Mark all read": how many it marked. */
export const markAllNotificationsRead = action(async (): Promise<Result<ReadAnswer>> => {
  await requireCurrentMember();
  return answer(await rpcMarkAllRead());
});
