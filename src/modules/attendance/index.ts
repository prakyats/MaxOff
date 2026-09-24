/**
 * modules/attendance: the public API (ARCHITECTURE §3.1: `app → modules (index.ts only) → core`).
 * The day gate itself (touch, pass, redirects) is `core/auth`, because the `(app)` layout runs
 * it before any module renders; this module owns the choice screen, the attendance strip, the
 * overtime note in the Log out confirmation, the attendance history and, since 2.4, the Owner's
 * review: the Attendance group of Approvals, today's card and people board.
 */
export { DayChoiceForm } from "./components/day-choice-form";
export { OvertimeLogoutNote } from "./components/overtime-logout-note";
export {
  TodayAttendanceStrip,
  TodayAttendanceStripSkeleton,
} from "./components/today-attendance-strip";
export { dayLabel } from "./domain/today";
export { AttendanceHistory } from "./components/attendance-history";
export { listDays } from "./data/attendance";
export { historyMonth, monthLabel, monthOf } from "./domain/months";
export { PendingDaysGroup } from "./components/pending-days-group";
export { PeopleBoard, TodayAttendanceCard, TodayBoardSkeleton } from "./components/today-board";
export { countPendingDays, getTodayPeople, listPendingDays } from "./data/review";
export { summariseToday } from "./domain/review";
/** The single approval, for the Approvals delayed send (`app/api/approvals/approve`). */
export { approveDay } from "./actions/review";
