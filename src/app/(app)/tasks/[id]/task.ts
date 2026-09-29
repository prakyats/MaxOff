import "server-only";

import { cache } from "react";

import { listClientLabels } from "@/modules/clients";
import {
  getTask,
  listAssignees,
  listComments,
  listReviews,
  listStages,
  listSubmissions,
  listTaskActivity,
} from "@/modules/tasks";
import { listDirectoryOf, listOwnFreelancerIds, type TeamMember } from "@/modules/team";

import { readCoordinators, readDirectory, readTaskDefinitions, readTaskTypes } from "../reads";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Everything a task's page reads but the names, in one parallel wave (ARCHITECTURE §19): the task
 * and its children (RLS: `app.task_visible()`, so a task the viewer may not see comes back null),
 * its history, who coordinates whom (the Owner's and Admins' `member_coordinators`; the viewer's
 * own freelancers from `coordinated_freelancers`, ADR-0013), the client label (ADR-0005: a label
 * at most) and the task custom fields. `cache()`d per request, and the four reads the dialog's
 * setup also makes are shared with it (`../reads`). The names are `loadNames`.
 */
export const loadTask = cache(async (id: string) => {
  const [
    task,
    assignees,
    stages,
    comments,
    submissions,
    reviews,
    activity,
    types,
    coordinators,
    ownFreelancers,
    labels,
    definitions,
  ] = await Promise.all([
    getTask(id),
    listAssignees(id),
    listStages(id),
    listComments(id),
    listSubmissions(id),
    listReviews(id),
    listTaskActivity(id),
    readTaskTypes(),
    readCoordinators(),
    listOwnFreelancerIds(),
    listClientLabels(),
    readTaskDefinitions(),
  ]);
  return {
    task,
    assignees,
    stages,
    comments,
    submissions,
    reviews,
    activity,
    types,
    coordinators,
    ownFreelancers,
    labels,
    definitions,
  };
});

type TaskReads = Awaited<ReturnType<typeof loadTask>>;

/** Everyone the page names: the people on the task and every actor in its rows and history. */
export function peopleNamed(data: TaskReads): string[] {
  const ids = new Set<string>(data.ownFreelancers);
  const add = (value: unknown) => {
    if (typeof value === "string" && UUID.test(value)) ids.add(value);
  };
  const task = data.task;
  if (task) {
    for (const id of [task.createdBy, task.approvingAdminId, task.primaryOwnerId]) add(id);
    for (const id of [task.submittedBy, task.submittedOnBehalfOf]) add(id);
  }
  for (const row of data.assignees) [row.memberId, row.acknowledgedBy].forEach(add);
  for (const row of data.stages) [row.doneBy, row.onBehalfOf].forEach(add);
  for (const row of data.comments) [row.authorId, row.onBehalfOf].forEach(add);
  for (const row of data.submissions) [row.submittedBy, row.onBehalfOf].forEach(add);
  for (const row of data.reviews) add(row.reviewerId);
  for (const entry of data.activity) {
    [
      entry.actorId,
      entry.onBehalfOfId,
      entry.meta.member_id,
      entry.meta.from,
      entry.meta.to,
    ].forEach(add);
  }
  for (const [freelancer, coordinator] of Object.entries(data.coordinators)) {
    if (ids.has(freelancer)) add(coordinator);
  }
  return [...ids];
}

/**
 * The names on the page. The Owner and Admins (`team.view`) read the whole directory, which is
 * quick for them and gives the Owner the Admins to route through; anyone else reads only the
 * people named, because `member_directory` is slow for them row by row (4A later item (a)).
 */
export function loadNames(teamView: boolean, data: Promise<TaskReads>): Promise<TeamMember[]> {
  return teamView ? readDirectory() : data.then((reads) => listDirectoryOf(peopleNamed(reads)));
}
