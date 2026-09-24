/**
 * modules/attendance: the public API (ARCHITECTURE §3.1: `app → modules (index.ts only) → core`).
 * The day gate itself (touch, pass, redirects) is `core/auth`, because the `(app)` layout runs
 * it before any module renders; this module owns the choice screen, the attendance strip, the
 * overtime note in the Log out confirmation and the attendance history.
 */
export { DayChoiceForm } from "./components/day-choice-form";
export { OvertimeLogoutNote } from "./components/overtime-logout-note";
export {
  TodayAttendanceStrip,
  TodayAttendanceStripSkeleton,
} from "./components/today-attendance-strip";
export { dayLabel } from "./domain/today";
export { AttendanceHistory } from "./components/attendance-history";
export { listOwnDays } from "./data/attendance";
export { historyMonth, monthLabel, monthOf } from "./domain/months";
