/**
 * modules/reports: the public API (ARCHITECTURE §3.1). The Admin's work report (6.3, PRODUCT §4.13;
 * Kickoff 6 decision 11): the task KPIs over a period, split by engagement, computed live from the
 * tasks the Admin sees (RLS). Never money, attendance or leave (PERMISSIONS `reports.scoped`). The
 * Owner's end-of-day report (6.5) is below, then the Owner's reports (v3.0, 9.3).
 */
export {
  acknowledgementLag,
  countWords,
  CUSTOM_MAX_DAYS,
  OWNER_CUSTOM_MAX_DAYS,
  ENGAGEMENT_LABELS,
  ENGAGEMENTS,
  hoursWords,
  loadThisWeek,
  loadWords,
  median,
  monthOf,
  nextPeriod,
  overdueNow,
  parsePeriod,
  periodHref,
  periodLabel,
  previousPeriod,
  rework,
  reworkWords,
  turnaround,
  weekOf,
  type Engagement,
  type LoadRow,
  type OpenTask,
  type Period,
  type ReportFacts,
  type ReworkValue,
  type Split,
} from "./domain/work-report";
export { ItemKpiCard, KpiCard, KpiCardSkeleton, LoadList } from "./components/work-report";
/** The end-of-day report (6.5; PRODUCT §4.7, WORKFLOWS §8a): the Owner's, live and saved. */
export { getEodReport, listEodReports, previewEodReport, type SavedEodReport } from "./data/eod";
export {
  cutoffWords,
  EOD_PAGE_SIZE,
  eodDateHeading,
  eodDayState,
  eodHref,
  eodListEntries,
  isQuietDay,
  liveNote,
  parseEodDate,
  parseEodReport,
  savedNote,
  type EodDayState,
  type EodListEntry,
  type EodReport,
} from "./domain/eod";
export { EodReportSkeleton, EodReportView } from "./components/eod-report";
/**
 * The Owner's reports (v3.0, 9.3; PRODUCT §4.13): People (with the delays), Stage durations and
 * Client work, counted by the database's `report_*` functions (`reports.all` only). Never money:
 * the client-work card's `revenue` slot is filled only by the page through `modules/revenue`.
 */
export {
  listClientWork,
  listDelays,
  listPeopleFacts,
  listStageDurations,
} from "./data/owner-reports";
export {
  clientLines,
  clientTotals,
  daysWords,
  delayPatterns,
  delayWords,
  medianWords,
  peopleRows,
  personLines,
  stageReport,
  stageWords,
  type ClientWorkFacts,
  type DelayFact,
  type DelayGroup,
  type FactLine,
  type Person,
  type PersonFacts,
  type PersonRow,
  type StageFact,
  type StageProject,
} from "./domain/owner-reports";
export {
  AttendanceFacts,
  CARD_GRID_CLASS,
  ClientWorkCard,
  ClientWorkCardSkeleton,
  DelayReport,
  DelayReportSkeleton,
  PersonCard,
  PersonCardSkeleton,
  ReportHeading,
  ReportHeadingSkeleton,
  StageCardSkeleton,
  StageOverall,
  StageProjectCard,
} from "./components/owner-reports";
