import "server-only";

import { cache } from "react";

import { clientLabelsFrom } from "@/modules/clients";
import { readTaskPage } from "@/modules/tasks";
import { coordinatorsFrom, listDirectoryOf, type TeamMember } from "@/modules/team";

import { readDirectory, readTaskDefinitions, readTaskTypes } from "../reads";

/**
 * The task page's back control (§14.2 k, 6b.12 (2)): its parent is Tasks, and it is drilled into
 * from these screens as well; back returns to the one it came from (the calendar's view and day
 * with it, the address its entry holds) and names it. From anywhere else (a notification, a link
 * opened directly) it replaces with Tasks.
 */
export const TASK_BACK = {
  href: "/tasks",
  label: "Tasks",
  from: [
    { path: "/calendar", label: "Calendar" },
    { path: "/today", label: "Today" },
    { path: "/today/people", label: "Everyone today" },
    { path: "/my-day", label: "My Day" },
    { path: "/approvals", label: "Approvals" },
    { path: "/notifications", label: "Alerts" },
    { path: "/tasks/all", label: "All tasks" },
    { path: "/tasks/requests", label: "Suggested tasks" },
    { path: "/reports/end-of-day/*", label: "End of day" },
  ],
} as const;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Everything a task's page reads but the names, in one parallel wave (ARCHITECTURE §19; since
 * v2.0 X3 most of it in one read, `task_page()`): the task
 * and its children (RLS: `app.task_visible()`, so a task the viewer may not see comes back null),
 * its history, who coordinates whom (the Owner's and Admins' `member_coordinators`; the viewer's
 * own freelancers from `coordinated_freelancers`, ADR-0013), the client label (ADR-0005: a label
 * at most), the task custom fields and the viewer's own last read of the comments (Kickoff 4
 * decision 28). `cache()`d per request, and the four reads the dialog's setup also makes are
 * shared with it (`../reads`). The names are `loadNames`.
 */
export const loadTask = cache(async (id: string) => {
  // v2.0 X3: the task, its children, its history, the viewer's own last read, who coordinates
  // whom, the viewer's freelancers and the client labels are one read (`task_page()`), each part
  // exactly as its own read gave it; the types and the task fields stay shared with the dialog.
  const [page, types, definitions] = await Promise.all([
    readTaskPage(id),
    readTaskTypes(),
    readTaskDefinitions(),
  ]);
  const { comments, more: earlierComments } = page.chat;
  return {
    task: page.task,
    assignees: page.assignees,
    stages: page.stages,
    comments,
    /** Earlier comments remain before the latest page (Chat's "Load earlier"). */
    earlierComments,
    submissions: page.submissions,
    reviews: page.reviews,
    activity: page.activity,
    types,
    coordinators: coordinatorsFrom(page.coordinatorRows),
    ownFreelancers: page.freelancers,
    labels: clientLabelsFrom(page.labelRows),
    definitions,
    lastRead: page.lastRead,
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
 * The names on the page. The Owner and Admins (`team.view`) read the whole directory, which gives
 * the Owner the Admins to route through; anyone else reads only the people the page names. Since
 * 4C their directory holds everyone who was on or acted on a task they can see (Kickoff 4 decision
 * 21), computed once per read (no longer row by row), so every name here resolves.
 */
export function loadNames(teamView: boolean, data: Promise<TaskReads>): Promise<TeamMember[]> {
  return teamView ? readDirectory() : data.then((reads) => listDirectoryOf(peopleNamed(reads)));
}
