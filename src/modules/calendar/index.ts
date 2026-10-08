/**
 * modules/calendar: the public API (ARCHITECTURE §3.1: `app → modules (index.ts only) → core`).
 * The calendar (6.4, reworked in 6.4b; Kickoff 6 decisions 13, 14, 22 and 25; PRODUCT §4.8): one
 * swipeable calendar on a phone (three sizes, the day's detail, the day sheet), Day · Week · Month
 * with hour timelines on a laptop, event tasks in their type's colour, leave, holidays and weekly
 * offs, each role seeing what PERMISSIONS §2 "Calendar" allows. The reads are other modules'
 * (tasks, leave, settings, team, clients, through their `index.ts`) plus one of its own
 * (`member_availability()`, an Admin's view of others); the rules are `domain/`. The client root,
 * `CalendarScreen`, is imported from `components/` one file at a time (ADR-0011 amendment); the
 * loading screen's skeleton is a server component and comes from here.
 */
export { listAvailability } from "./data/availability";
export {
  addMonths,
  buildCalendar,
  CALENDAR_VIEWS,
  calendarHref,
  dayHeading,
  dayWord,
  DEFAULT_EVENT_COLOR,
  EMPTY_DAY,
  emptyDay,
  filterCount,
  filterKinds,
  hasFilters,
  isEmptyDay,
  monthEnd,
  monthGrid,
  monthLabel,
  monthOf,
  parseCalendarQuery,
  rangeFor,
  scopeFor,
  shifted,
  STATUS_FILTER_LABELS,
  STATUS_FILTERS,
  timeWords,
  weekLabel,
  weekOf,
  type AvailabilitySource,
  type BusyItem,
  type CalendarDay,
  type CalendarInput,
  type CalendarQuery,
  type CalendarScope,
  type CalendarView,
  type DateRange,
  type DueItem,
  type DueSource,
  type EventItem,
  type EventSource,
  type LeaveItem,
  type LeaveSource,
  type MonthGrid,
  type PersonSource,
  type StatusFilter,
} from "./domain/calendar";
export { whoFreeLine, whoIsFree, type FreePerson, type WhoFree } from "./domain/who-free";
export { CalendarSkeleton } from "./components/calendar-skeleton";
