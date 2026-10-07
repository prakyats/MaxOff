/**
 * modules/attendance: the public API (ARCHITECTURE §3.1: `app → modules (index.ts only) → core`).
 * The working day (3b.1): the Start-day prompt the `(app)` layout mounts, the attendance strip,
 * Start day / End day, the attendance history and, since 2.4, the Owner's review: the Attendance
 * group of Approvals, today's card and people board.
 *
 * Client components are not exported here: a route imports them one file at a time from
 * `components/` (ADR-0011 amendment, task 2.8), because a barrel is not tree-shaken per route.
 */
export {
  TodayAttendanceStrip,
  TodayAttendanceStripSkeleton,
} from "./components/today-attendance-strip";
export { dayLabel, promptDue } from "./domain/today";
export { getOwnToday, listDays } from "./data/attendance";
export { addMonths, historyMonth, monthLabel, monthOf, monthRange } from "./domain/months";
export {
  PeopleBoard,
  PeopleNeedingYou,
  PersonRowsSkeleton,
  PersonTodayLine,
  PersonTodayLineSkeleton,
  TodayAttendanceCard,
  TodayBoardSkeleton,
  TodayCardSkeleton,
} from "./components/today-board";
export { countPendingDays, getTodayPeople, listPendingDays } from "./data/review";
/** Extra work notes (3b.2): the member's list and note days, the Owner's group and its count. */
export { countPendingNotes, getNoteDays, listOwnNotes, listPendingNotes } from "./data/notes";
export { ExtraWorkNotesList } from "./components/extra-work-notes-list";
export type { NoteDay } from "./domain/notes";
export { summariseToday, type TodayPerson, type TodaySummary } from "./domain/review";
/** The single approval, for the Approvals delayed send (`app/api/approvals/approve`). */
export { approveDay } from "./actions/review";
/** The month summary (3b.4): one person's IST month or the team's, for the Owner. */
export { getMonthSummary } from "./data/summary";
export type { MonthSummary } from "./domain/summary";
export { MonthSummaryCard, MonthSummarySkeleton, TeamMonthList } from "./components/month-summary";
