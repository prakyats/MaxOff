"use server";

import { revalidatePath } from "next/cache";

import { action, ok, type Result } from "@/core/errors";
import { dispatchPushSoon } from "@/core/notifications/push/dispatch";
import { assertPermission } from "@/core/permissions/server";

import * as repo from "../data/notes";
import {
  type DecideNoteInput,
  decideNoteSchema,
  type SubmitNoteInput,
  submitNoteSchema,
} from "../domain/schemas";

/**
 * Extra work notes (PRODUCT §4.3a, 3b.2; ARCHITECTURE §4.2): zod → `assertPermission()` → the
 * transition function → revalidate → `Result`. The rules (7 days back, the kind by calendar, one
 * note per day, ½ or 1 day) live in the functions.
 */

/** The member's own note: overtime, or "I worked today" on a day off. Notifies the Owner (5.1). */
export const submitExtraWorkNote = action(
  async (input: SubmitNoteInput): Promise<Result<{ noteId: string }>> => {
    const data = submitNoteSchema.parse(input);
    await assertPermission("attendance.self");
    const noteId = await repo.rpcSubmitNote(data);
    revalidatePath("/leave/extra-work");
    revalidatePath("/approvals");
    dispatchPushSoon();
    return ok({ noteId });
  },
);

/** The Owner's decision on a note: grant ½ or 1 day, or none; a day off marked as worked. */
export const decideExtraWorkNote = action(
  async (input: DecideNoteInput): Promise<Result<{ creditId: string | null }>> => {
    const data = decideNoteSchema.parse(input);
    await assertPermission("attendance.decide");
    const creditId = await repo.rpcDecideNote(data);
    // The layout carries the Approvals badge, so the whole signed-in tree refreshes.
    revalidatePath("/", "layout");
    dispatchPushSoon();
    return ok({ creditId });
  },
);
