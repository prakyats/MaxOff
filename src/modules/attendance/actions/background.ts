import "server-only";

import { AppError } from "@/core/errors";
import { assertPermission } from "@/core/permissions/server";
import { todayIST } from "@/core/time";

import * as repo from "../data/review";
import { reviewWeek, type WeekDay } from "../domain/review-context";
import { approveDaySchema } from "../domain/schemas";

/**
 * The attendance module's **background call** (ARCHITECTURE §4.4), `GET
 * /api/attendance/review-context?day=<id>`: read when the Owner opens a day's Review panel (B4),
 * never a server action. zod → `assertPermission("attendance.decide")` → the repository. The
 * person's week around the day; the route adds their comp leave balance from `modules/leave`.
 */
export async function readReviewWeek(
  input: unknown,
): Promise<{ memberId: string; week: WeekDay[] }> {
  const data = approveDaySchema.parse(input);
  await assertPermission("attendance.decide");
  const context = await repo.readDayContext(data.dayId);
  if (!context) throw new AppError("NOT_FOUND");
  return {
    memberId: context.memberId,
    week: reviewWeek(context.days, context.workDate, todayIST()),
  };
}
