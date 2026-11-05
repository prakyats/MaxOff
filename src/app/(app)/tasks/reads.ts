import "server-only";

import { cache } from "react";

import { listAllDefinitions } from "@/core/custom-fields/server";
import type { ISODate } from "@/core/time";
import { listClientLabels, listClients } from "@/modules/clients";
import { listOpenTaskRows, listOwnWeek, listTaskTemplates, listTaskTypes } from "@/modules/tasks";
import { listCurrentCoordinators, listDirectory, listOwnFreelancerIds } from "@/modules/team";

/**
 * The reads a task's page, the Tasks lists and the task dialog's setup share, once per request
 * (4B review S11): the page renders both for the Owner and Admins, and each used to read these
 * itself. Since 4C the directory is cheap for every role (`app.directory_visible_ids()`, Kickoff 4
 * decision 21), so the lists read it whole.
 */
export const readTaskTypes = cache(listTaskTypes);
export const readDirectory = cache(listDirectory);
export const readCoordinators = cache(listCurrentCoordinators);
export const readTaskDefinitions = cache(() => listAllDefinitions("task"));
export const readOpenTasks = cache(listOpenTaskRows);
export const readClientLabels = cache(listClientLabels);
export const readOwnFreelancers = cache(listOwnFreelancerIds);
export const readTaskTemplates = cache(listTaskTemplates);
/** The week strip's one read (v2.0 X3, `own_week()`), once per request and window. */
export const readWeekWindow = cache(listOwnWeek);
/**
 * The freelancers the viewer coordinates now, from the week read the page already makes
 * (`own_week().freelancers`, v2.0 X3): no read of their own. An own_week without the key (an
 * older function) or one that failed is read the usual way, so the lists never lose them.
 */
export function readFreelancersWith(from: ISODate, to: ISODate): Promise<string[]> {
  return readWeekWindow(from, to).then(
    (week) => week.freelancers ?? readOwnFreelancers(),
    () => readOwnFreelancers(),
  );
}
/**
 * The clients a task may be labelled with (Kickoff 4 decision 22: Active or Paused; RLS gives an
 * Admin their own), with each one's Admin: the dialog's label list, and the Admin a suggestion's
 * label pre-selects for the Owner (decision 3).
 */
export const readLabelClients = cache(() => listClients({ states: ["active", "paused"] }));
