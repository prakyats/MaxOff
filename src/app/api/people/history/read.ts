import "server-only";

import { z } from "zod";

import { ACTIVITY_LIMIT } from "@/core/activity";
import { listActivity } from "@/core/activity/server";
import { AppError } from "@/core/errors";
import { assertPermission } from "@/core/permissions/server";
import { describeMemberActivity, listDirectory, type MemberHistoryLine } from "@/modules/team";

/** What the person page's History sheet shows: the newest lines, and the cap when more were cut. */
export type PersonHistoryData = { lines: MemberHistoryLine[]; limitedTo: number | null };

const inputSchema = z.object({ memberId: z.uuid() });

/**
 * A person's History (PP-person-1; the header's clock, as every record page's): the latest
 * changes to their member row, newest first, one sentence each, read from the audit log under RLS
 * (the Owner's `activity.view_all`; anyone else reads only their own row's entries, and the page
 * shows the clock to the Owner alone). **Read only when the sheet opens** (a background call,
 * ARCHITECTURE §4.4), never with the person's layout.
 */
export async function readPersonHistory(input: unknown): Promise<PersonHistoryData> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION");
  await assertPermission("activity.view_all");
  const [entries, members] = await Promise.all([
    listActivity([{ entity: "members", ids: [parsed.data.memberId] }]),
    listDirectory(),
  ]);
  const names = Object.fromEntries(members.map((member) => [member.id, member.fullName]));
  return {
    lines: entries.flatMap((entry) => {
      const line = describeMemberActivity(entry, names);
      return line ? [line] : [];
    }),
    limitedTo: entries.length >= ACTIVITY_LIMIT ? ACTIVITY_LIMIT : null,
  };
}
