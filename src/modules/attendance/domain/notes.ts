import { addISTDays, formatIST, istDayStart } from "@/core/time";

import { formatDays } from "./comp-days";
import { historyDate } from "./history";

/**
 * Extra work notes (PRODUCT §4.3a, 3b.2): an overtime note on a working day, or an "I worked
 * today" note on a day off, up to 7 days back, reviewed by the Owner. Pure, so it is unit-tested.
 */

export type ExtraWorkKind = "overtime" | "day_off";
export const EXTRA_WORK_KINDS = ["overtime", "day_off"] as const satisfies readonly ExtraWorkKind[];

export type ExtraWorkNote = {
  id: string;
  memberId: string;
  workDate: string;
  kind: ExtraWorkKind;
  durationMinutes: number | null;
  note: string;
  state: "submitted" | "reviewed";
  decision: "granted" | "no_comp_leave" | null;
  dayMarkedWorked: boolean;
  createdAt: string;
  /** The credit the Owner granted for it, when they did. */
  credit: { days: number; expiresOn: string } | null;
};

export const KIND_LABELS: Record<ExtraWorkKind, string> = {
  overtime: "Overtime",
  day_off: "Worked on a day off",
};

/** How many days back a note may go (kickoff 3b decision 10): today and the 7 before it. */
export const NOTE_DAYS_BACK = 7;

/** The rough durations the overtime note offers, in minutes; free text is not worth the typing. */
export const DURATION_OPTIONS = [30, 60, 90, 120, 180, 240, 300, 360] as const;

/** "30 min", "1 h", "1½ h", "2 h". */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${formatDays(Math.round(hours * 2) / 2)} h`;
}

/** One selectable day for the note dialog: the date, its label and what kind of note it takes. */
export type NoteDay = { date: string; label: string; kind: ExtraWorkKind };

/**
 * The days a note may be about, today first: each is an overtime note (a working day) or an "I
 * worked today" note (a day off), decided by the calendar the same way the database decides it
 * (`app.is_working_day`). `isWorkingDay` comes from the caller's calendar read.
 */
export function noteDays(today: string, isWorkingDay: (date: string) => boolean): NoteDay[] {
  const days: NoteDay[] = [];
  for (let back = 0; back <= NOTE_DAYS_BACK; back += 1) {
    const date = addISTDays(today, -back);
    const label =
      back === 0
        ? `Today, ${formatIST(istDayStart(date), "d MMM")}`
        : back === 1
          ? `Yesterday, ${formatIST(istDayStart(date), "d MMM")}`
          : historyDate(date);
    days.push({ date, label, kind: isWorkingDay(date) ? "overtime" : "day_off" });
  }
  return days;
}

/** "Overtime · Wed, 23 Sep · 2 h", "Worked on a day off · Sun, 27 Sep". */
export function noteTitle(
  note: Pick<ExtraWorkNote, "kind" | "workDate" | "durationMinutes">,
): string {
  const parts = [KIND_LABELS[note.kind], historyDate(note.workDate)];
  if (note.kind === "overtime" && note.durationMinutes)
    parts.push(durationLabel(note.durationMinutes));
  return parts.join(" · ");
}

/**
 * The outcome in the member's words (kickoff 3b decision 13): "Waiting for the Owner", "1 comp
 * leave granted · use by 31 Oct" or the neutral "Reviewed by the Owner", plus "Counted as a day
 * worked" when the Owner said so.
 */
export function noteOutcome(
  note: Pick<ExtraWorkNote, "state" | "decision" | "dayMarkedWorked" | "credit">,
  viewpoint: "self" | "owner" = "self",
): { text: string; status: "submitted" | "approved" | "none" } {
  if (note.state === "submitted") {
    return {
      text: viewpoint === "self" ? "Waiting for the Owner" : "Waiting for you",
      status: "submitted",
    };
  }
  const worked = note.dayMarkedWorked ? " · Counted as a day worked" : "";
  if (note.decision === "granted" && note.credit) {
    const days = formatDays(note.credit.days);
    return {
      text: `${days} comp leave granted · use by ${formatIST(istDayStart(note.credit.expiresOn), "d MMM")}${worked}`,
      status: "approved",
    };
  }
  return {
    text: `${viewpoint === "self" ? "Reviewed by the Owner" : "Reviewed"}${worked}`,
    status: "none",
  };
}

/** Whether a day may still take a note: today or up to 7 days back. */
export function canAddNote(workDate: string, today: string): boolean {
  return workDate <= today && workDate >= addISTDays(today, -NOTE_DAYS_BACK);
}

/** The Owner's choices on a note (decision 12): grant ½, grant 1, or no comp leave. */
export type NoteDecision = "grant_half" | "grant_full" | "no_comp_leave";
export const NOTE_DECISIONS = [
  "grant_full",
  "grant_half",
  "no_comp_leave",
] as const satisfies readonly NoteDecision[];
export const NOTE_DECISION_LABELS: Record<NoteDecision, string> = {
  grant_full: "Grant 1 day of comp leave",
  grant_half: "Grant ½ day of comp leave",
  no_comp_leave: "No comp leave",
};
