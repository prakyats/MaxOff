import "server-only";

import { cache } from "react";

import { addISTDays, type ISODate, todayIST } from "@/core/time";
import { listEarlyLeaveRequests, listPendingDays, listPendingNotes } from "@/modules/attendance";
import {
  countItemsToDecide,
  countOverdueItems,
  listCurrentCycles,
  listItemRows,
  listItemStages,
  listLastChanges,
  listReviews,
  listSentBack,
  splitHeldItems,
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
import { listTasksToDecide } from "@/modules/tasks";

import {
  readEscalationWith,
  readFreelancersWith,
  readRequestsToDecideWith,
  readWeekWindow,
} from "../tasks/reads";

/**
 * The reads Today's two screens use, once per request (`cache()`): the page starts the shared
 * ones with the session read (ARCHITECTURE §19), and the screen the role picks calls the same
 * reads again and gets the promises in flight.
 */
/**
 * The week strip's event tasks and holidays in one read (v2.0 X3, `own_week()`), once per request:
 * the page starts it with the session read and both screens get the same promise.
 */
export const readEventTasks = (from: ISODate, to: ISODate) =>
  readWeekWindow(from, to).then((week) => week.events);
/**
 * How far the event tasks are read: 62 days (an Admin's Issues check an event's day that far,
 * `member_availability()`'s limit); the strip shows the first seven. One read for both screens.
 */
export function eventsHorizon(today: ISODate): ISODate {
  return addISTDays(today, 61);
}
/** The holidays in Today's window (the week strip keeps its seven days), from the same read. */
export const readHolidays = () => {
  const today = todayIST();
  return readWeekWindow(today, eventsHorizon(today)).then((week) => week.holidays);
};
/** The freelancers the viewer coordinates, from the same read (`own_week().freelancers`). */
export const readTodayFreelancers = () => {
  const today = todayIST();
  return readFreelancersWith(today, eventsHorizon(today));
};
/** The suggestions to decide, from the same read (`own_week().requests_to_decide`). */
export const readRequestsToDecide = () => {
  const today = todayIST();
  return readRequestsToDecideWith(today, eventsHorizon(today));
};
/** Needs you's escalation thresholds, from the same read (`own_week()`'s `ack_escalate_*`). */
export const readEscalation = () => {
  const today = todayIST();
  return readEscalationWith(today, eventsHorizon(today));
};
export const readLeaveDays = cache(listLeaveDays);
export const readNotNoted = cache(listNotNoted);
export const readUnreachable = cache(listUnreachable);
export const readHeldEmails = cache(countHeldEmails);
export const readClients = cache(() => listClients());
/** The Owner's approvals, every group (the preview takes the oldest five in group order). */
export const readApprovals = cache(() =>
  Promise.all([
    listPendingDays(),
    listPendingRequests(),
    listPendingNotes(),
    listPendingClaims(),
    listTasksToDecide({ final: true }),
    // v1.9 W4 Q2: the early-leave requests waiting for the Owner (RLS: his; the page asks only
    // for `attendance.decide`).
    listEarlyLeaveRequests(),
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
  // v1.9 W8: a held project's deliverables wait for its resume: never due, late or sent back here.
  return {
    due: splitHeldItems(due).active,
    sentBack: splitHeldItems(sentBack).active,
    toDecide,
  };
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
