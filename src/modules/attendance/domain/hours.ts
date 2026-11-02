import { clockWords } from "@/core/time/clock-words";

/**
 * Working hours, late starts and leaving early: the screens' words (v1.9 W4; WORKFLOWS §1 "Working
 * hours, late starts and leaving early"; the owner-approved samples `docs/design/v19-working-hours-
 * sample.html` and `v19-screens-sample.html`). The rules are the database's (`app.attendance_hours`,
 * `attendance_own_hours()`, `attendance_hours_today()`, `month_summary_hours()`); this only reads
 * them and words them. Pure and date-fns-free (it runs in the strip's client buttons too), so it is
 * unit-tested.
 */

export type Half = "morning" | "afternoon";
export const HALVES = ["morning", "afternoon"] as const satisfies readonly Half[];

export type EarlyLeaveState =
  "waiting" | "approved" | "stay" | "left_unanswered" | "corrected" | "lapsed";

/** The caller's own working hours today (`attendance_own_hours()`). Instants are ISO strings. */
export type OwnHours = {
  workDate: string;
  /** `org_settings.working_hours_on`: off, every screen is as before v1.9. */
  rulesOn: boolean;
  lateApplies: boolean;
  earlyApplies: boolean;
  half: Half | null;
  startAt: string;
  lateAfter: string;
  endAt: string;
  endSource: "work" | "shoot" | "stay";
  stayUntil: string | null;
  lateMinutes: number | null;
  lateReason: string | null;
  /** "Shoot at 2:00 pm": a shoot later today, for the late reason to start from. */
  lateReasonSuggestion: string | null;
  earlyLeave: {
    id: string;
    state: EarlyLeaveState;
    reason: string;
    requestedAt: string;
    /** While waiting: when End day comes back without an answer. */
    endFrom: string | null;
  } | null;
  canEndNow: boolean;
  /** `org_settings.early_leave_wait_minutes`: how long an unanswered ask waits (the ask sheet). */
  waitMinutes: number | null;
};

const MINUTE = 60_000;

/** "4:30 pm" for an instant (IST). */
export function timeOf(instant: string): string {
  return clockWords(new Date(instant));
}

/** "22 min", "1 h", "1 h 5 min": a duration in the strip's chip and the Owner's rows. */
export function minutesWords(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** "22 minutes", "1 minute", "1 hour 5 minutes": the late sheet's title says it in full. */
export function minutesInFull(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const unit = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  if (whole < 60) return unit(whole, "minute");
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? unit(hours, "hour") : `${unit(hours, "hour")} ${unit(rest, "minute")}`;
}

/** "Late 22 min": the amber chip (sample §1). */
export function lateChip(minutes: number): string {
  return `Late ${minutesWords(minutes)}`;
}

/** Today's Late rule as Start day needs it: the start, Late after it, and the suggested reason. */
export type LateRule = { startAt: string; lateAfter: string; suggestion: string | null };

/** The Late rule today, or null when there is none (the switch off, a day off, a morning half). */
export function lateRule(hours: OwnHours | null): LateRule | null {
  if (!hours || !hours.rulesOn || !hours.lateApplies) return null;
  return {
    startAt: hours.startAt,
    lateAfter: hours.lateAfter,
    suggestion: hours.lateReasonSuggestion,
  };
}

/**
 * How late a Start day tapped at `now` would be, in minutes after the start time, or null when it
 * is not Late (before the start plus the grace, or no Late rule today). The database decides the
 * recorded figure; this only decides whether Start day asks for the reason first (sample §1).
 */
export function lateMinutesAt(rule: LateRule | null, now: Date): number | null {
  if (!rule) return null;
  if (now.getTime() <= new Date(rule.lateAfter).getTime()) return null;
  return Math.floor((now.getTime() - new Date(rule.startAt).getTime()) / MINUTE);
}

/** "You're starting 22 minutes late" (the late sheet's title). */
export function lateSheetTitle(minutes: number): string {
  return `You're starting ${minutesInFull(minutes)} late`;
}

export const LATE_SHEET_DESCRIPTION = "Add a line for the Owner. It doesn't stop you working.";

/** What End day is while the day is open (the strip's button). */
export type EndAction = "end" | "ask" | "none";

/** The working-hours part of the strip for a started, open day (or an ended one's facts). */
export type HoursStrip = {
  /** "Late 22 min" (amber) and the reason, when the day was a late start. */
  late: { chip: string; reason: string | null } | null;
  /** "Your day ends at 6:00 pm", with why it is later when it is (a shoot, Stay until). */
  endLine: string | null;
  /** The early-leave request's status, when there is one to show. */
  early: {
    tone: "waiting" | "approved" | "stay" | "unanswered";
    label: string;
    text: string;
  } | null;
  /** End day, Ask to leave early, or nothing (waiting for the Owner's answer). */
  endAction: EndAction;
  /** When the strip next changes on its own (End day comes back): the page re-reads then. */
  refreshAt: string | null;
};

/**
 * The strip's working-hours words (sample §1–2). `open`: the day is started and not ended. With the
 * rules off (or none today, a day off, full leave) it is empty and End day is as before.
 */
export function hoursStrip(hours: OwnHours | null, open: boolean, now: Date): HoursStrip {
  const empty: HoursStrip = {
    late: null,
    endLine: null,
    early: null,
    endAction: "end",
    refreshAt: null,
  };
  if (!hours || !hours.rulesOn) return empty;
  const late =
    hours.lateMinutes !== null
      ? { chip: lateChip(hours.lateMinutes), reason: hours.lateReason }
      : null;
  const request = hours.earlyLeave;

  if (!open) {
    // An ended day keeps its facts: Late, and how an early leave ended.
    const early =
      request?.state === "approved"
        ? {
            tone: "approved" as const,
            label: "Approved",
            text: `The Owner approved. Your day ended at ${timeOf(request.requestedAt)}.`,
          }
        : request?.state === "left_unanswered"
          ? {
              tone: "unanswered" as const,
              label: "Left early",
              text: "Left early, not answered. The Owner will review it.",
            }
          : null;
    return { ...empty, late, early };
  }

  if (!hours.earlyApplies) return { ...empty, late };

  const endsAt = timeOf(hours.endAt);
  const endLine =
    hours.endSource === "shoot"
      ? `Your shoot runs till ${endsAt}, so today ends at ${endsAt}.`
      : hours.endSource === "stay"
        ? `The Owner asked you to stay until ${endsAt}. Your day ends at ${endsAt}.`
        : `Your day ends at ${endsAt}`;
  const afterEnd = now.getTime() >= new Date(hours.endAt).getTime();

  if (request?.state === "waiting") {
    const asked = timeOf(request.requestedAt);
    const ago = minutesWords((now.getTime() - new Date(request.requestedAt).getTime()) / MINUTE);
    const endFrom = request.endFrom ? timeOf(request.endFrom) : null;
    if (hours.canEndNow || afterEnd) {
      return {
        late,
        endLine,
        early: {
          tone: "waiting",
          label: "No answer",
          text: afterEnd
            ? `Asked to leave at ${asked}. Your end time has come: you can end your day.`
            : `Asked to leave at ${asked} · ${ago} ago. No answer yet: you can end your day. It's marked "Left early, not answered".`,
        },
        endAction: "end",
        refreshAt: null,
      };
    }
    return {
      late,
      endLine,
      early: {
        tone: "waiting",
        label: "Waiting",
        text: `Asked to leave at ${asked} · ${ago} ago.${endFrom ? ` You can end your day at ${endFrom} if there's no answer.` : ""}`,
      },
      endAction: "none",
      refreshAt: earliest(request.endFrom, hours.endAt, now),
    };
  }

  const stay =
    request?.state === "stay"
      ? {
          tone: "stay" as const,
          label: "Stay",
          text: `The Owner asked you to stay until ${endsAt}. You'll be reminded then.`,
        }
      : null;
  if (hours.canEndNow || afterEnd) {
    return { late, endLine, early: stay, endAction: "end", refreshAt: null };
  }
  return {
    late,
    endLine,
    early: stay,
    endAction: "ask",
    refreshAt: earliest(hours.endAt, null, now),
  };
}

/** The earlier of two future instants (the strip re-reads then), or null. */
function earliest(a: string | null, b: string | null, now: Date): string | null {
  const future = [a, b].filter(
    (value): value is string => value !== null && new Date(value).getTime() > now.getTime(),
  );
  if (future.length === 0) return null;
  return future.reduce((first, value) =>
    new Date(value).getTime() < new Date(first).getTime() ? value : first,
  );
}

/** The ask sheet's words (sample §2). */
export function askSheetDescription(endAt: string, waitMinutes: number | null): string {
  const wait =
    waitMinutes === null
      ? ""
      : ` If there's no answer in ${minutesInFull(waitMinutes)}, you can end your day.`;
  return `Your day ends at ${timeOf(endAt)}. The Owner decides.${wait}`;
}

export const EARLY_REASON_MAX_LENGTH = 300;
export const LATE_REASON_MAX_LENGTH = 200;

// The Owner's side -------------------------------------------------------------------------------

/** An early-leave request the Owner decides (Approvals "Leaving early" / "Left early, not answered"). */
export type EarlyLeaveRequest = {
  id: string;
  memberId: string;
  memberName: string;
  memberAvatarFileId: string | null;
  workDate: string;
  state: "waiting" | "left_unanswered";
  reason: string;
  requestedAt: string;
  leftAt: string | null;
  dayId: string;
};

/** "PShetty · leave at 4:30 pm", "Prakyat · ended 4:05 pm" (sample §3). */
export function earlyLeaveTitle(request: EarlyLeaveRequest): string {
  return request.state === "waiting"
    ? `${request.memberName} · leave at ${timeOf(request.requestedAt)}`
    : `${request.memberName} · ended ${timeOf(request.leftAt ?? request.requestedAt)}`;
}

/** "Doctor's appointment at 5 · waiting 12 min", "Asked at 3:30 pm · "Family function"". */
export function earlyLeaveSubtitle(
  request: EarlyLeaveRequest,
  now: Date,
  today: string,
  dateLabel: (date: string) => string,
): string {
  if (request.state === "waiting") {
    const waited = (now.getTime() - new Date(request.requestedAt).getTime()) / MINUTE;
    return `${request.reason} · waiting ${minutesWords(waited)}`;
  }
  const day = request.workDate === today ? "" : `${dateLabel(request.workDate)} · `;
  return `${day}Asked at ${timeOf(request.requestedAt)} · “${request.reason}”`;
}

/** One person's working hours today, for the Owner (`attendance_hours_today()`). */
export type HoursToday = {
  memberId: string;
  rulesOn: boolean;
  startedAt: string | null;
  endedAt: string | null;
  lateMinutes: number | null;
  lateReason: string | null;
  endAt: string;
  endSource: "work" | "shoot" | "stay";
  stayUntil: string | null;
  earlyLeaveState: EarlyLeaveState | null;
  leftEarly: boolean;
  endedAfterEnd: boolean;
};

/** The Owner's Today lines (sample §3): Late (amber, hidden at zero), ended after the end time. */
export function hoursTodayCounts(rows: readonly HoursToday[]): { late: number; afterEnd: number } {
  const on = rows.filter((row) => row.rulesOn);
  return {
    late: on.filter((row) => row.lateMinutes !== null).length,
    afterEnd: on.filter((row) => row.endedAfterEnd).length,
  };
}

/** "1 started late today", "2 ended after their end time": null at zero (the line is hidden). */
export function lateLineWords(late: number): string | null {
  if (late <= 0) return null;
  return `${late} started late today`;
}
export function afterEndLineWords(count: number): string | null {
  if (count <= 0) return null;
  return `${count} ended after the end time`;
}

/** A board row's working-hours words: "Late 22 min · “Traffic”", "Stay until 8:00 pm". */
export function boardHoursDetail(row: HoursToday | undefined): string | null {
  if (!row || !row.rulesOn) return null;
  const parts: string[] = [];
  if (row.lateMinutes !== null) {
    parts.push(
      row.lateReason
        ? `${lateChip(row.lateMinutes)} · “${row.lateReason}”`
        : lateChip(row.lateMinutes),
    );
  }
  if (row.stayUntil) parts.push(`Stay until ${timeOf(row.stayUntil)}`);
  if (row.earlyLeaveState === "waiting") parts.push("Asked to leave early");
  else if (row.earlyLeaveState === "left_unanswered") parts.push("Left early, not answered");
  else if (row.earlyLeaveState === "approved") parts.push("Left early, approved");
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Whether "Stay until" can be set for this person now: started, not ended, rules on. */
export function canSetStayUntil(row: HoursToday | undefined): boolean {
  return Boolean(row && row.rulesOn && row.startedAt && !row.endedAt);
}

// The month counts (owner 2026-10-22) ------------------------------------------------------------

/** One person's month counts (`month_summary_hours()`). */
export type MonthHours = {
  lateDays: number;
  lateMinutes: number;
  leftUnanswered: number;
  earlyLeavesApproved: number;
  halfDaysMorning: number;
  halfDaysAfternoon: number;
};

/** "—" for zero, else the number (sample §5). */
export function countFigure(value: number): string {
  return value === 0 ? "—" : String(value);
}

/** The four counts, labelled, in the sample's order (the Month report's columns, a person's rows). */
export function monthHoursCounts(hours: MonthHours): {
  key: "late" | "unanswered" | "approved" | "half";
  label: string;
  /** The Month report's column words (the sample's table heads). */
  short: string;
  value: string;
  detail: string | null;
  tone: "attention" | null;
}[] {
  const halves = hours.halfDaysMorning + hours.halfDaysAfternoon;
  return [
    {
      key: "late",
      label: "Late days",
      short: "Late",
      value: countFigure(hours.lateDays),
      detail: hours.lateDays > 0 ? `${minutesWords(hours.lateMinutes)} in all` : null,
      tone: hours.lateDays > 0 ? "attention" : null,
    },
    {
      key: "unanswered",
      label: "Left early, not answered",
      short: "Left early, not answered",
      value: countFigure(hours.leftUnanswered),
      detail: null,
      tone: null,
    },
    {
      key: "approved",
      label: "Early leaves approved",
      short: "Early approved",
      value: countFigure(hours.earlyLeavesApproved),
      detail: null,
      tone: null,
    },
    {
      key: "half",
      label: "Half days",
      short: "Half days",
      value: countFigure(halves),
      detail:
        halves > 0
          ? `${hours.halfDaysMorning} morning · ${hours.halfDaysAfternoon} afternoon`
          : null,
      tone: null,
    },
  ];
}

// Half days (sample §4) ---------------------------------------------------------------------------

export const HALF_COPY: Record<Half, { label: string; hint: string }> = {
  morning: { label: "Morning off", hint: "Start your day after lunch. You won't be marked late" },
  afternoon: {
    label: "Afternoon off",
    hint: "End your day after lunch. No need to ask to leave early",
  },
};
