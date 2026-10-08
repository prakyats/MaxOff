import "server-only";

import { cache } from "react";

import { withSessionUserId } from "@/core/auth/server";
import { addISTDays, type ISODate } from "@/core/time";
import { listPendingDays, listPendingNotes } from "@/modules/attendance";
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
