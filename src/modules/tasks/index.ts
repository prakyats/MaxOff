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
/** Server components (no state, no handlers): a list row and its block (4.5). */
export {
  TaskRow,
  TaskRowList,
  TaskRowsSkeleton,
  TaskSectionHeadingSkeleton,
} from "./components/task-row";
export {
  getTask,
  listAssignees,
  listComments,
  listReviews,
  listStages,
  listSubmissions,
  listTaskActivity,
  listTaskTypes,
  countOpenAssignments,
  countTasks,
  listFinishedTaskRows,
  listOpenTaskRows,
  listTasksToDecide,
  type TaskToDecide,
} from "./data/tasks";
export { countRequestsToDecide, listTaskRequests } from "./data/requests";
export { listTaskTemplates } from "./data/templates";
export { listTaskTypeSettings } from "./data/task-types";
export { type TaskTypeSetting } from "./domain/task-types";
export {
  badgeCount,
  byDeadline,
  forLabel,
  isOwnWork,
  managesTask,
  MY_GROUP_TITLES,
  MY_GROUPS,
  MY_LIST_GROUPS,
  myTaskGroups,
  needsYou,
  openByDeadline,
  ownPart,
  rowMeta,
  waitedLabel,
  type ListViewer,
  type MyGroup,
  type MyTaskItem,
  type NeedsYouItem,
  type NeedsYouReason,
  type OwnPart,
  type TaskListRow,
} from "./domain/lists";
export {
  ALL,
  FILTER_DEFAULT_LABELS,
  filterDefaultLabels,
  NO_CLIENT,
  STATE_FILTER_LABELS,
  STATE_FILTERS,
  type FilterableTask,
  type StateFilter,
} from "./domain/list-filters";
export {
  opensTask,
  REQUEST_STATE_LABELS,
  requestActions,
  requestByline,
  requestOutcome,
  splitRequests,
  type RequestActions,
  type RequestState,
  type RequestViewer,
  type TaskRequest,
} from "./domain/requests";
export {
  activeTemplates,
  applyTemplate,
  templateActions,
  type TaskTemplate,
  type TemplateActions,
} from "./domain/templates";
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
/** The Approvals screen's single approve, behind the delayed send's route (4.5). */
export { approveTask } from "./actions/approvals";
