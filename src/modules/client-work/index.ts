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
  completeWords,
  cycleMeter,
  itemMeter,
  meterLine,
  meterPace,
  type CycleMeter,
  type MeterItem,
} from "./domain/progress";
export {
  clientProgressLine,
  progressByClient,
  projectSummaries,
  type CurrentCycleStates,
  type ProjectSummary,
} from "./domain/projects";
export {
  cycleLabel,
  itemListPeriods,
  type ItemListPeriods,
  nextStartable,
  periodNext,
  periodStart,
} from "./domain/periods";
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
  orderDeliverables,
  type ItemRowView,
  type ItemStageView,
  type ItemView,
  type ItemViewContext,
  type LastChange,
} from "./domain/views";
export { cycleExtras, extrasCycles, extrasQuestion, type ExtraCandidate } from "./domain/extras";
export { renamePreview, shiftDays, shiftWords, type RenamePreview } from "./domain/bulk";
export { scheduleDay, scheduleText, type ScheduleItem } from "./domain/schedule";
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
  listCurrentCycleMeters,
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
  type CurrentCycleMeter,
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
  addStageGroup,
  archiveBlueprint,
  archiveStage,
  archiveStageGroup,
  cancelProject,
  completeProject,
  createGroupedProject,
  createProject,
  reopenProject,
  startNextCycle,
  updateBlueprint,
  updateProject,
  updateStage,
  updateStageGroup,
} from "./actions/projects";
export {
  addItem,
  addItemStage,
  addItemStageGroup,
  archiveItemStage,
  archiveItemStageGroup,
  cancelItem,
  carryDecide,
  markItemDone,
  markItemsDone,
  reopenItem,
  tickItemStage,
  tickStages,
  updateItem,
  updateItemStage,
  updateItemStageGroup,
} from "./actions/items";
export {
  addGroupsToItems,
  addRevisionRound,
  keepExtras,
  planItems,
  renameItems,
  shiftItems,
} from "./actions/bulk";
export {
  ACTIVITY_PAGE,
  readDeliverableTemplateOptions,
  readProjectActivity,
} from "./actions/background";
/** The project page's deliverable columns (6b.11 (6)), for its skeleton to trace. */
export { DELIVERABLE_COLUMNS } from "./components/deliverable-columns";
