/**
 * modules/attendance: the public API (ARCHITECTURE §3.1: `app → modules (index.ts only) → core`).
 * The day gate itself (touch, pass, redirects) is `core/auth`, because the `(app)` layout runs
 * it before any module renders; this module owns the choice screen and the attendance card.
 */
export { DayChoiceForm } from "./components/day-choice-form";
export {
  TodayAttendanceCard,
  TodayAttendanceCardSkeleton,
} from "./components/today-attendance-card";
export { dayLabel } from "./domain/today";
