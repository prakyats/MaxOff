/**
 * **The one status → colour map** (B13, ADR-0015, docs/DESIGN.md §4): every workflow state in
 * DATA-MODEL §0 maps to one of six tones (ARCHITECTURE §3.3). Code depends only on those enums
 * (ADR-0002), so new task types or stage names never need a new colour: they're plain data. The
 * map is keyed by the enum *value*, which is shared across enums where the meaning matches
 * (`approved`, `cancelled`, `open`, ...). Pure (no React), so a domain function can ask for a
 * tone too; `StatusBadge` / `StatusDot` (`core/ui/composites/status-badge.tsx`) draw it.
 * `status-badge.test.ts` proves every value maps to a tone and every tone passes 4.5:1.
 */
export const STATUS_TONES_LIST = [
  "success",
  "info",
  "attention",
  "danger",
  "neutral",
  "brand",
] as const;
export type StatusTone = (typeof STATUS_TONES_LIST)[number];

export const STATUS_TONES = {
  // success: finished and accepted
  approved: "success",
  completed: "success",
  done: "success",
  settled: "success",
  billed: "success",
  present: "success",
  active: "success",
  // info: work in motion, nothing else
  in_progress: "info",
  submitted: "info",
  converted: "info",
  // attention: someone must act
  admin_approved: "attention",
  pending_review: "attention",
  awaiting_choice: "attention",
  changes_requested: "attention",
  pending: "attention",
  paused: "attention",
  leave_pending: "attention",
  not_billed: "attention",
  high: "attention",
  // danger: act now
  rejected: "danger",
  absent: "danger",
  cancelled: "danger",
  declined: "danger",
  urgent: "danger",
  // neutral: not started, closed quietly, informational, or a plain label
  invited: "neutral",
  leave: "neutral",
  half_day: "neutral",
  comp_leave: "neutral",
  carry_forward: "neutral",
  corrected: "neutral",
  draft: "neutral",
  todo: "neutral",
  open: "neutral",
  inactive: "neutral",
  withdrawn: "neutral",
  superseded: "neutral",
  carried: "neutral",
  close: "neutral",
  deactivated: "neutral",
  required: "neutral",
  none: "neutral",
  skipped: "neutral",
  medium: "neutral",
  low: "neutral",
} as const satisfies Record<string, StatusTone>;

export type KnownStatus = keyof typeof STATUS_TONES;

/**
 * An attendance day's status for its colour, one rule on every screen (B13, UX review
 * 2026-10-21: "Absent (proposed)" was red in End of day, amber elsewhere). A day the Owner has
 * not decided yet (a proposed absence, a choice waiting) is `pending_review`, amber, whatever it
 * proposes; a decided day takes its final status (absent red, present green, leave neutral); no
 * status and nothing waiting is `awaiting_choice`.
 */
export function attendanceStatus(day: { status: string | null; undecided: boolean }): string {
  if (day.undecided) return "pending_review";
  return day.status ?? "awaiting_choice";
}

export function statusTone(status: string): StatusTone {
  return (STATUS_TONES as Record<string, StatusTone>)[status] ?? "neutral";
}
