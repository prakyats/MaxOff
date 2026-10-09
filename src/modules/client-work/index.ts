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
  stageChoices,
  stagesByItem,
  weekEnd,
  type AdminGroup,
  type ItemFilter,
  type Progress,
} from "./domain/items";
export {
  clientProgressLine,
  progressByClient,
  projectSummaries,
  type CurrentCycleStates,
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
  type ItemStageView,
  type ItemView,
  type ItemViewContext,
  type LastChange,
} from "./domain/views";
export {
  ACTIVITY_KINDS,
  describeProjectActivity,
  INTERNAL_KEYS,
  lastChangeOf,
  type ActivityKind,
  type ActivityPage,
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
  type ItemStage,
  type ItemState,
  type Project,
  type ProjectState,
  type Recurrence,
  type Review,
  type Stage,
} from "./domain/types";
export {
  getProject,
  listBlueprints,
  listClientProjects,
  listCurrentCycles,
  listCycles,
  listCyclesById,
  listItems,
  listItemsById,
  listItemStages,
  listLastChanges,
  listProjectsActivity,
  listReviews,
  listStages,
  listStagesOf,
  type CurrentCycle,
} from "./data/projects";
export {
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
  addItemStage,
  archiveItemStage,
  cancelItem,
  carryDecide,
  markItemDone,
  markItemsDone,
  reopenItem,
  tickItemStage,
  tickStages,
  updateItem,
  updateItemStage,
} from "./actions/items";
export { ACTIVITY_PAGE, readProjectActivity } from "./actions/background";
