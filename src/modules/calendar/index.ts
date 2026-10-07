/**
 * modules/calendar: the public API (ARCHITECTURE §3.1: `app → modules (index.ts only) → core`).
 * The calendar (6.4; Kickoff 6 decisions 13–15, 22; PRODUCT §4.8): day, week and month views of
 * event tasks, leave, holidays and weekly offs, each role seeing what PERMISSIONS §2 "Calendar"
 * allows. The reads are other modules' (tasks, leave, settings, team, clients, through their
 * `index.ts`) plus one of its own (`member_availability()`, an Admin's view of others); the
 * rules are `domain/` and the views are server components. The one client component, the
 * filters, is imported from `components/` one file at a time (ADR-0011 amendment).
 */
export { listAvailability } from "./data/availability";
export {
  addMonths,
  buildCalendar,
  CALENDAR_VIEWS,
  calendarHref,
  dayHeading,
  dayWord,
  dueWords,
  EMPTY_DAY,
  emptyDay,
  eventWords,
  filterKinds,
  hasFilters,
  isEmptyDay,
  leaveWords,
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
export {
  CalendarControlsSkeleton,
  CalendarPager,
  ViewSwitcher,
  WeekStrip,
} from "./components/calendar-controls";
export {
  CalendarRowsSkeleton,
  DayRows,
  DayView,
  MonthView,
  WeekView,
} from "./components/calendar-views";
