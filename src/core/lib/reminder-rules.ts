/**
 * Task reminder rules (5.3; WORKFLOWS "Settled at kickoff 5", owner answers 2026-10-02). A list of
 * up to 5 rules `{"before": N, "unit": "minutes" | "hours" | "days"}`, N a whole number from 0
 * ("when due") to 60 days, no two at the same time before the deadline. **An empty list means
 * "use the next level"**: a task's own, then its template's, its type's, the organisation's, then
 * the launch schedule below (`app.task_reminder_rules`). The checks mirror
 * `app.reminder_rules_valid` exactly, so whatever passes here the database takes; the actions'
 * zod schema is `reminder-rules-schema.ts`, kept apart so no client bundle carries zod.
 *
 * Pure and shared: the task dialog and Settings → Task types and Templates (modules/tasks), and
 * Settings → Thresholds (modules/settings) edit the same lists with the same editor
 * (`core/ui/composites/reminder-rules-editor.tsx`).
 */

export const REMINDER_UNITS = ["minutes", "hours", "days"] as const;
export type ReminderUnit = (typeof REMINDER_UNITS)[number];
export type ReminderRule = { before: number; unit: ReminderUnit };

export const REMINDERS_MAX = 5;
/** 60 days, in minutes: the furthest a reminder may be before the deadline. */
export const REMINDER_MAX_MINUTES = 60 * 1440;

const UNIT_MINUTES: Record<ReminderUnit, number> = { minutes: 1, hours: 60, days: 1440 };

/** The launch schedule (owner, kickoff 5): 2 days before, 1 day before, when due. */
export const LAUNCH_REMINDERS: readonly ReminderRule[] = [
  { before: 2, unit: "days" },
  { before: 1, unit: "days" },
  { before: 0, unit: "minutes" },
];

/** How far before the deadline a rule fires, in minutes ("1 day" and "24 hours" are the same). */
export function reminderMinutes(rule: ReminderRule): number {
  return rule.before * UNIT_MINUTES[rule.unit];
}

export const REMINDER_MESSAGES = {
  whole: "Use a whole number, like 2.",
  tooFar: "Up to 60 days before the deadline.",
  same: "Another reminder is already at this time.",
  tooMany: `Up to ${REMINDERS_MAX} reminders.`,
} as const;

function isRule(value: unknown): value is ReminderRule {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("before") || !keys.includes("unit")) return false;
  const { before, unit } = value as { before: unknown; unit: unknown };
  return (
    typeof before === "number" &&
    Number.isInteger(before) &&
    before >= 0 &&
    typeof unit === "string" &&
    (REMINDER_UNITS as readonly string[]).includes(unit) &&
    reminderMinutes({ before, unit: unit as ReminderUnit }) <= REMINDER_MAX_MINUTES
  );
}

/**
 * Whether a value is a valid list, as `app.reminder_rules_valid` decides: up to 5 rules, each
 * exactly `before` (a whole number from 0) and `unit`, at most 60 days, no two at the same time.
 * No zod here on purpose: the editor and the Settings forms run this file in the browser (the
 * actions' schema is `reminder-rules-schema.ts`).
 */
export function isReminderRuleList(value: unknown): value is ReminderRule[] {
  if (!Array.isArray(value) || value.length > REMINDERS_MAX) return false;
  if (!value.every(isRule)) return false;
  return new Set(value.map(reminderMinutes)).size === value.length;
}

/**
 * A stored list (jsonb) as rules. Every stored list passes `app.reminder_rules_valid` (the CHECK
 * constraints); anything else reads as `[]`, "use the next level", as the database's resolution
 * would never see it.
 */
export function parseReminderRules(value: unknown): ReminderRule[] {
  return isReminderRuleList(value)
    ? value.map((rule) => ({ before: rule.before, unit: rule.unit }))
    : [];
}

function unitWord(unit: ReminderUnit, count: number): string {
  const singular = unit === "minutes" ? "minute" : unit === "hours" ? "hour" : "day";
  return count === 1 ? singular : `${singular}s`;
}

/** One rule as people read it: "2 days before", "1 hour before", "when due". */
export function describeReminder(rule: ReminderRule): string {
  if (rule.before === 0) return "when due";
  return `${rule.before} ${unitWord(rule.unit, rule.before)} before`;
}

/**
 * A list as one line, the earliest first: "2 days before, 1 day before, when due". `[]` has no
 * description of its own (it means the next level): `resolveReminders` gives the list that applies.
 */
export function describeReminders(rules: readonly ReminderRule[]): string {
  return [...rules]
    .sort((a, b) => reminderMinutes(b) - reminderMinutes(a))
    .map(describeReminder)
    .join(", ");
}

/** The list that applies: the first level with rules of its own, else the launch schedule. */
export function resolveReminders(
  levels: readonly (readonly ReminderRule[] | null | undefined)[],
): readonly ReminderRule[] {
  return (
    levels.find((level) => level !== null && level !== undefined && level.length > 0) ??
    LAUNCH_REMINDERS
  );
}

/** Two lists the same, rule for rule, in order. */
export function sameReminders(a: readonly ReminderRule[], b: readonly ReminderRule[]): boolean {
  return (
    a.length === b.length &&
    a.every((rule, index) => rule.before === b[index]?.before && rule.unit === b[index]?.unit)
  );
}

// The editor's rows -----------------------------------------------------------------------------

/** One row as typed: the number is text until it is checked. */
export type ReminderRow = { before: string; unit: ReminderUnit };

/**
 * A level's list being edited: `null` while it uses the default (the next level, saved as `[]`),
 * else the rows as typed. Removing every row also saves `[]`.
 */
export type ReminderDraft = ReminderRow[] | null;

export function rowsFromRules(rules: readonly ReminderRule[]): ReminderRow[] {
  return rules.map((rule) => ({ before: String(rule.before), unit: rule.unit }));
}

/** A level's own list as the editor starts from it: `[]` is "using the default" (`null`). */
export function draftFromRules(rules: readonly ReminderRule[]): ReminderDraft {
  return rules.length === 0 ? null : rowsFromRules(rules);
}

/** Each row's message (null when it is fine), in the order of the rows. */
export function reminderRowErrors(rows: readonly ReminderRow[]): (string | null)[] {
  const seen = new Set<number>();
  return rows.map((row) => {
    const text = row.before.trim();
    if (!/^\d{1,5}$/.test(text)) return REMINDER_MESSAGES.whole;
    const minutes = reminderMinutes({ before: Number(text), unit: row.unit });
    if (minutes > REMINDER_MAX_MINUTES) return REMINDER_MESSAGES.tooFar;
    if (seen.has(minutes)) return REMINDER_MESSAGES.same;
    seen.add(minutes);
    return null;
  });
}

/**
 * The list a draft saves: `[]` while it uses the default (or has no rows), the rules when every
 * row is fine, `null` when a row needs fixing (or there are more than 5).
 */
export function rulesFromDraft(draft: ReminderDraft): ReminderRule[] | null {
  if (draft === null) return [];
  if (draft.length > REMINDERS_MAX) return null;
  if (reminderRowErrors(draft).some((message) => message !== null)) return null;
  return draft.map((row) => ({ before: Number(row.before.trim()), unit: row.unit }));
}

/** What "Add a reminder" offers first: the first of these not already in the list. */
const NEW_ROW_CHOICES: readonly ReminderRule[] = [
  { before: 1, unit: "days" },
  { before: 0, unit: "minutes" },
  { before: 2, unit: "days" },
  { before: 1, unit: "hours" },
  { before: 3, unit: "hours" },
  { before: 3, unit: "days" },
  { before: 30, unit: "minutes" },
];

/** A new row for "Add a reminder": a time no other row has yet (a valid row, nothing to fix). */
export function nextReminderRow(rows: readonly ReminderRow[]): ReminderRow {
  const taken = new Set(
    rows
      .filter((row) => /^\d{1,5}$/.test(row.before.trim()))
      .map((row) => reminderMinutes({ before: Number(row.before.trim()), unit: row.unit })),
  );
  const free = NEW_ROW_CHOICES.find((rule) => !taken.has(reminderMinutes(rule)));
  return rowsFromRules([free ?? { before: 7, unit: "days" }])[0] as ReminderRow;
}

/** The unit as the row reads: "day" after 1, "days" otherwise. */
export function reminderUnitLabel(unit: ReminderUnit, before: string): string {
  return unitWord(unit, Number(before.trim()));
}
