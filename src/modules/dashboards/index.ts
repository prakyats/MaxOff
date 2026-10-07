/**
 * modules/dashboards: the public API (ARCHITECTURE §3.1: `app → modules (index.ts only) → core`).
 * The day screens (6A, Kickoff 6 decisions 1–12, 22, 23; PRODUCT §4.7): Crew's My Day, the
 * Owner's Today and the Admin's. They compose other modules' reads (through their `index.ts`) and
 * add their own rules (`domain/`), the three risk reads the API cannot make (`data/signals.ts`,
 * migration `dashboards_today`) and their blocks, all server components (the first-load budget,
 * 6.0): nothing here hydrates, so the barrel exports no client component.
 */
export { countHeldEmails, listLeaveDays, listNotNoted, listUnreachable } from "./data/signals";
export { clockWord, dayWord, inlineDay, nextDays } from "./domain/days";
export {
  byStart,
  MY_DAY_AHEAD_DAYS,
  MY_DAY_EMPTY,
  MY_DAY_GROUPS,
  moreThisWeekLine,
  myDayEvents,
  quietLine,
  upcomingLine,
  upcomingWithin,
  type DayEvent,
  type MyDayGroup,
  type QuietLeave,
} from "./domain/my-day";
export {
  ADMIN_NEEDS_YOU_EMPTY,
  adminScope,
  boardForGroup,
  clientCounts,
  clientCountsLine,
  eventsStrip,
  heldEmailsLine,
  leaveRisks,
  leaveWindow,
  notNotedRisks,
  OWNER_TODAY_EMPTY,
  overdueRisks,
  parsePeopleGroup,
  PEOPLE_GROUPS,
  RISKS_EMPTY,
  RISKS_SHOWN,
  riskWords,
  sortRisks,
  spanWords,
  STRIP_DAYS,
  todaysTasks,
  todaysTasksLine,
  type HeldEmails,
  type LeaveDay,
  type PeopleGroup,
  type Risk,
  type RiskTask,
} from "./domain/today";
export {
  DashSection,
  DashSectionHeadingSkeleton,
  LinkRow,
  LinkRowsSkeleton,
  QuietText,
  QuietTextSkeleton,
  RowList,
} from "./components/blocks";
export {
  EventRows,
  EventRowsSkeleton,
  EventsStrip,
  EventsStripSkeleton,
  RiskRows,
} from "./components/day-blocks";
