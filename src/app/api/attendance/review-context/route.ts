import { backgroundGet } from "@/core/http/background-route";
import { readReviewWeek, type ReviewContext } from "@/modules/attendance";
import { compBalanceWords, getCompBalance } from "@/modules/leave";

/**
 * The attendance Review panel's context (B4, UX review 2026-10-21): `?day=<id>`, read when the
 * Owner opens a waiting day's Review. The person's week around the day (attendance, checked for
 * `attendance.decide`) and their comp leave balance (leave): only what the Owner already sees on
 * the person's history. A background call (ARCHITECTURE §4.4): a plain request, never a server
 * action that could hold a navigation.
 */
export const dynamic = "force-dynamic";

export const GET = backgroundGet(async (query): Promise<ReviewContext> => {
  const { memberId, week } = await readReviewWeek({ dayId: query.get("day") });
  const compLeave = compBalanceWords(await getCompBalance(memberId));
  return { week, compLeave };
});
