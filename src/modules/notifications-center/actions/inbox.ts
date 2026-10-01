"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentMember } from "@/core/auth/server";
import { action, AppError, ok, type Result } from "@/core/errors";
import { markOneRead, rpcMarkAllRead, rpcMarkRecordRead } from "@/core/notifications/inbox";

/**
 * The member's read receipts (task 5.1, kickoff 5 decision 4): zod → the member → the write →
 * revalidate → `Result`. Every member has notifications of their own, so no permission key
 * beyond being an active member; RLS keeps each to their own rows. A read is view state, not
 * audited (DATA-MODEL §9). The bell's count is in the layout, so a change revalidates the whole
 * signed-in tree; a write that changed nothing revalidates nothing.
 */
async function requireCurrentMember() {
  const member = await getCurrentMember();
  if (!member) throw new AppError("UNAUTHENTICATED");
  return member;
}

function revalidateBell(): void {
  revalidatePath("/", "layout");
}

const idSchema = z.object({ id: z.uuid() });

/** A row with nothing to open, tapped: it is read (a row with a link is read by `/open`). */
export const markNotificationRead = action(
  async (input: z.input<typeof idSchema>): Promise<Result<{ marked: number }>> => {
    const { id } = idSchema.parse(input);
    await requireCurrentMember();
    const marked = (await markOneRead(id))?.marked ? 1 : 0;
    if (marked > 0) revalidateBell();
    return ok({ marked });
  },
);

/** "Mark all read": how many it marked. */
export const markAllNotificationsRead = action(async (): Promise<Result<{ marked: number }>> => {
  await requireCurrentMember();
  const marked = await rpcMarkAllRead();
  if (marked > 0) revalidateBell();
  return ok({ marked });
});

/** The records a notification can be about, as `notifications.entity` names them. */
const RECORD_ENTITIES = ["tasks", "clients", "members"] as const;
const recordSchema = z.object({ entity: z.enum(RECORD_ENTITIES), id: z.uuid() });

/**
 * Opening a record marks the member's unread notifications about it read (kickoff 5 decision 4;
 * `notifications_mark_read`). Sent in the background by `MarkRecordRead` on the record's page.
 */
export const markRecordRead = action(
  async (input: z.input<typeof recordSchema>): Promise<Result<{ marked: number }>> => {
    const { entity, id } = recordSchema.parse(input);
    await requireCurrentMember();
    const marked = await rpcMarkRecordRead(entity, id);
    if (marked > 0) revalidateBell();
    return ok({ marked });
  },
);
