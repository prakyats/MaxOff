import "server-only";

import { cache } from "react";

import { withSessionUserId } from "@/core/auth/server";
import { addISTDays, type ISODate } from "@/core/time";
import { listPendingDays, listPendingNotes } from "@/modules/attendance";
import {
  countItemsToDecide,
  countOverdueItems,
  listCurrentCycles,
  listItemRows,
  listItemStages,
  listLastChanges,
  listReviews,
  listSentBack,
  weekEnd,
} from "@/modules/client-work";
import { listClients } from "@/modules/clients";
import {
  countHeldEmails,
  listLeaveDays,
  listNotNoted,
  listUnreachable,
} from "@/modules/dashboards";
import { listPendingClaims } from "@/modules/expenses";
import { listPendingRequests } from "@/modules/leave";
import { getSettings, listHolidays } from "@/modules/settings";
import { countRequestsToDecide, listEventTasks, listTasksToDecide } from "@/modules/tasks";

/**
 * The reads Today's two screens use, once per request (`cache()`): the page starts the shared
 * ones with the session read (ARCHITECTURE §19), and the screen the role picks calls the same
 * reads again and gets the promises in flight.
 */
export const readEventTasks = cache(listEventTasks);
/**
 * How far the event tasks are read: 62 days (an Admin's Issues check an event's day that far,
 * `member_availability()`'s limit); the strip shows the first seven. One read for both screens.
 */
export function eventsHorizon(today: ISODate): ISODate {
  return addISTDays(today, 61);
}
export const readHolidays = cache(listHolidays);
export const readSettings = cache(getSettings);
export const readLeaveDays = cache(listLeaveDays);
export const readNotNoted = cache(listNotNoted);
export const readUnreachable = cache(listUnreachable);
export const readHeldEmails = cache(countHeldEmails);
export const readClients = cache(() => listClients());
export const readRequestsToDecide = cache(() => withSessionUserId(countRequestsToDecide));
/** The Owner's approvals, every group (the preview takes the oldest five in group order). */
export const readApprovals = cache(() =>
  Promise.all([
    listPendingDays(),
    listPendingRequests(),
    listPendingNotes(),
    listPendingClaims(),
    listTasksToDecide({ final: true }),
  ]),
);

/** The Owner's one client-work line: "N client items overdue" (amendment C E1, decision 24). */
export const readOverdueItems = cache((today: ISODate) => countOverdueItems(today));

/**
 * The Admin's client work (kickoff 7 decision 19, amendments C and D): open items planned up to
 * Sunday, the items sent back to them and the count behind Needs you (no approval count since D3:
 * done is the approval). RLS gives an Admin only the clients they run.
 */
export const readAdminClientWork = cache(async (today: ISODate, viewerId: string) => {
  const [due, sentBack, toDecide] = await Promise.all([
    listItemRows({ states: ["open"], plannedTo: weekEnd(today) }),
    listSentBack(viewerId),
    countItemsToDecide(today),
  ]);
  return { due, sentBack, toDecide };
});

/** The own stages, reviews and last changes of the items Today shows (at most a handful). */
export async function readItemDetails(itemIds: string[]) {
  const [stages, reviews, lastChanges] = await Promise.all([
    listItemStages(itemIds),
    listReviews(itemIds),
    listLastChanges(itemIds),
  ]);
  return { stages, reviews, lastChanges };
}

/**
 * The working projects' current cycles with their items' states, in one request (the Admin's "My
 * clients" progress, kickoff 7; the Admin report's Cycle progress): never every cycle ever made.
 */
export const readClientProgress = cache((today: ISODate) => listCurrentCycles(today));
