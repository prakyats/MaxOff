/**
 * modules/client-work: the public API (ARCHITECTURE §3.1: `app → modules (index.ts only) → core`).
 * Projects, stages, item lists, cycles and items of a client (PRODUCT §4.5, WORKFLOWS §5): 7A built
 * the tables, transition functions and jobs; 7B (7.3, 7.4) this server surface and the screens.
 * Never an amount (ADR-0007).
 *
 * Client components are not exported here: a route imports them one file at a time from
 * `components/` (ADR-0011 amendment).
 */
export {
  ITEM_RULES,
  ITEM_FILTER_LABELS,
  ITEM_FILTERS,
  activeStages,
  carriedFromLabel,
  currentCycle,
  cycleEnded,
  dueThisWeek,
  groupByAdmin,
  isOverdue,
  itemCount,
  matchesFilter,
  parseItemFilter,
  plannedLine,
  progressLine,
  progressOf,
  shortDate,
  sortCycles,
  sortItemRows,
  sortItems,
  tickedStages,
  weekEnd,
  type AdminGroup,
  type ItemFilter,
  type Progress,
} from "./domain/items";
export {
  clientProgressLine,
  progressByClient,
  projectSummaries,
  type ProjectSummary,
} from "./domain/projects";
export { cycleLabel, nextStartable, periodNext, periodStart } from "./domain/periods";
export {
  cycleProgressWords,
  onTime,
  onTimeWords,
  sitLongest,
  sitWords,
  type SitRow,
} from "./domain/kpis";
export {
  itemRowView,
  itemView,
  type ItemRowView,
  type ItemView,
  type ItemViewContext,
} from "./domain/views";
export {
  describeProjectActivity,
  INTERNAL_KEYS,
  type ActivityLine as ProjectActivityLine,
} from "./domain/activity";
export {
  ITEM_STATE_LABELS,
  ITEM_STATUS,
  PROJECT_STATE_LABELS,
  RECURRENCE_LABELS,
  RECURRENCES,
  type Blueprint,
  type CarryDecision,
  type Cycle,
  type Item,
  type ItemRow,
  type ItemState,
  type Project,
  type ProjectState,
  type Recurrence,
  type Review,
  type Stage,
  type Tick,
} from "./domain/types";
export {
  getProject,
  listBlueprints,
  listClientProjects,
  listCycleStates,
  listCycles,
  listCyclesById,
  listItems,
  listItemsById,
  listProjectActivity,
  listProjectsActivity,
  listReviews,
  listStages,
  listStagesOf,
  listTicks,
  listWorkingProjects,
} from "./data/projects";
export {
  countItemsToApprove,
  countItemsToDecide,
  countOverdueItems,
  listItemRows,
  listPlannedItems,
  listSentBack,
  type ItemQuery,
} from "./data/items";
export {
  addBlueprint,
  addStage,
  archiveBlueprint,
  archiveStage,
  cancelProject,
  completeProject,
  createProject,
  reopenProject,
  startNextCycle,
  updateBlueprint,
  updateProject,
  updateStage,
} from "./actions/projects";
export {
  addItem,
  approveItem,
  approveItems,
  cancelItem,
  carryDecide,
  markItemDone,
  markItemsDone,
  rejectItem,
  tickStage,
  tickStageOn,
  unmarkItemDone,
  updateItem,
} from "./actions/items";
