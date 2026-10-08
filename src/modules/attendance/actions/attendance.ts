"use server";

import { revalidatePath } from "next/cache";

import { setHomeHint } from "@/core/auth/server";
import { action, ok, type Result } from "@/core/errors";
import { dispatchPushSoon } from "@/core/notifications/push/dispatch";
import { assertPermission } from "@/core/permissions/server";

import {
  type ChooseLeaveTodayInput,
  chooseLeaveTodaySchema,
  type EndDayInput,
  endDaySchema,
} from "../domain/schemas";
import * as repo from "../data/attendance";

/**
 * Attendance actions (ARCHITECTURE §4.2): zod → `assertPermission()` → transition function →
 * revalidate → `Result`. The rules (states, dates, the day changing) live in the functions.
 */

/**
 * The `(app)` layout carries the Start-day prompt and the home screens carry the strip, so a
 * change to today's day refreshes the whole signed-in tree.
 */
function revalidateDay(): void {
  revalidatePath("/", "layout");
}

/**
 * Start day (PRODUCT §4.2, 3b.1): the tap is the start. The database opens today's day when
 * there is none and refuses a day off, a second start or a day already on leave. The home hint's
 * daily refresh (2.7, `core/auth/home-hint.ts`) rides on it, as it rode on the day gate's pass.
 */
export const startDay = action(async (): Promise<Result<{ dayId: string }>> => {
  const member = await assertPermission("attendance.self");
  const dayId = await repo.rpcStartDay();
  await setHomeHint(member.id, member.role);
  revalidateDay();
  return ok({ dayId });
});

/**
 * End day: final for the day; after midnight it lands on yesterday's started day. The
 * confirmation's optional overtime note (3b.2) lands with it, in the same transaction.
 */
export const endDay = action(
  async (input: EndDayInput = {}): Promise<Result<{ dayId: string; workDate: string }>> => {
    const data = endDaySchema.parse(input);
    await assertPermission("attendance.self");
    const ended = await repo.rpcEndDay(data.overtimeNote, data.overtimeMinutes);
    revalidateDay();
    return ok(ended);
  },
);

/** The prompt's "On leave today? Choose leave": Leave or Half day for today, for the Owner. */
export const chooseLeaveToday = action(
  async (input: ChooseLeaveTodayInput): Promise<Result<null>> => {
    const data = chooseLeaveTodaySchema.parse(input);
    await assertPermission("attendance.self");
    await repo.rpcChooseLeaveToday(data.choice, data.reason);
    revalidateDay();
    dispatchPushSoon();
    return ok(null);
  },
);
