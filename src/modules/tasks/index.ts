/**
 * modules/tasks: the public API (ARCHITECTURE §3.1: `app → modules (index.ts only) → core`).
 * Staff tasks (PRODUCT §4.6, WORKFLOWS §3, DATA-MODEL §6): 4A built the schema and the transition
 * functions; 4B the create / edit dialog (4.3) and the task page (4.4); the lists and Approvals
 * are 4C's. A task carries a client *label* at most, never a link to client work (ADR-0005).
 *
 * Client components are not exported here: a route imports them one file at a time from
 * `components/` (ADR-0011 amendment, task 2.8), because a barrel is not tree-shaken per route.
 * `LinkedText` is a server component (no state, no handlers), so it is.
 */
export { LinkedText } from "./components/linked-text";
export {
  getTask,
  listAssignees,
  listComments,
  listReviews,
  listStages,
  listSubmissions,
  listTaskActivity,
  listTaskTypes,
} from "./data/tasks";
export {
  describeTaskActivity,
  type TaskActivityContext,
  type TaskHistoryLine,
} from "./domain/activity";
export { linkSegments, type TextSegment } from "./domain/links";
export {
  activeAssignees,
  actorPair,
  deadlineLabel,
  eventLabel,
  isFinal,
  isLocked,
  isOverdue,
  latestChangeRequest,
  pairName,
  reviewerName,
  routeLine,
  stateLabel,
  statusLine,
  taskActions,
  type TaskActions,
  type TaskViewer,
} from "./domain/task";
export {
  PRIORITY_LABELS,
  type AdminOption,
  type AssignablePerson,
  type ClientOption,
  type PeopleIndex,
  type Task,
  type TaskAssignee,
  type TaskComment,
  type TaskReview,
  type TaskStage,
  type TaskSubmission,
  type TaskType,
} from "./domain/types";
