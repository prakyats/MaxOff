import "server-only";

import { withSessionUserId } from "@/core/auth/server";
import { addISTDays, type ISODate } from "@/core/time";
import { MY_DAY_AHEAD_DAYS, ownLeaveDays, ownWeekDays, weekBlocks } from "@/modules/dashboards";
import { listApprovedLeaveBetween } from "@/modules/leave";
import { forLabel, type myTaskGroups } from "@/modules/tasks";

import { readFreelancersWith, readWeekWindow } from "./reads";

/**
 * A reader's own "This week" (FINAL 8, major change 1, PP-crew-7), shared by My Day and the Tasks
 * tab's "My tasks": the one read (their event tasks, the holidays, their own approved leave over
 * the next `MY_DAY_AHEAD_DAYS`), started by each page **with its own wave** (never after the
 * session read), and the blocks built from it and the page's own task groups.
 */
export function readOwnWeek(today: ISODate) {
  const last = addISTDays(today, MY_DAY_AHEAD_DAYS - 1);
  // The event tasks, the holidays and the own leave in one read (v2.0 X3, `own_week()`).
  const week = readWeekWindow(today, last);
  return Promise.all([
    week.then((answer) => answer.events),
    week.then((answer) => answer.holidays),
    // The own approved leave rides in the same read; an older own_week is read the usual way.
    week.then(
      (answer) =>
        (answer.leave as Awaited<ReturnType<typeof listApprovedLeaveBetween>> | undefined) ??
        withSessionUserId((id) => listApprovedLeaveBetween(id, today, last)),
    ),
  ]);
}

/** The freelancers the reader coordinates, from the same read (`readFreelancersWith`). */
export function readOwnWeekFreelancers(today: ISODate): Promise<string[]> {
  return readFreelancersWith(today, addISTDays(today, MY_DAY_AHEAD_DAYS - 1));
}

export type OwnWeekRead = Awaited<ReturnType<typeof readOwnWeek>>;

/**
 * The holidays, their events (the place, and whose when it is a freelancer's), each of their own
 * deadlines by name, and their own leave; never anyone else's event (decision 2).
 */
export function ownWeek(input: {
  read: OwnWeekRead;
  viewerId: string;
  /** Their freelancers (ADR-0013). */
  own: readonly string[];
  groups: ReturnType<typeof myTaskGroups>;
  nameOf: (id: string) => string;
  today: ISODate;
}) {
  const [events, holidays, leave] = input.read;
  const { viewerId, own, groups, today } = input;
  const last = addISTDays(today, MY_DAY_AHEAD_DAYS - 1);
  const mine = new Set([viewerId, ...own]);
  const forWhom = (event: { assigneeIds: readonly string[] }) => {
    if (event.assigneeIds.includes(viewerId)) return null;
    const theirs = event.assigneeIds.filter((id) => own.includes(id));
    return theirs.length > 0 ? capitalise(forLabel(theirs, input.nameOf)) : null;
  };
  const ownRows = new Map(
    (["not_noted", "changes_requested", "overdue", "due_today", "upcoming"] as const)
      .flatMap((group) => groups[group])
      .map((item) => [item.row.id, item.row] as const),
  );
  return weekBlocks({
    days: ownWeekDays({
      from: today,
      to: last,
      holidays,
      events: events
        .filter((event) => event.assigneeIds.some((id) => mine.has(id)))
        .map((event) => ({
          ...event,
          detail: [event.location, forWhom(event)].filter(Boolean).join(" · ") || null,
        })),
      due: [...ownRows.values()],
    }),
    leave: ownLeaveDays(viewerId, leave, { from: today, to: last }),
    nameOf: () => "You",
    today,
    selfId: viewerId,
  });
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
