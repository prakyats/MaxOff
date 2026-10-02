import { type ReminderRule, resolveReminders } from "@/core/lib/reminder-rules";

/**
 * A task's reminders (5.3; WORKFLOWS "Settled at kickoff 5"). The rule format, the checks, the
 * launch schedule and the editor's rows are `core/lib/reminder-rules` (Settings → Thresholds
 * edits the organisation's list with the same rules); this is what the task's own screens add.
 *
 * Resolution, each level replacing the one below (no merge), as `app.task_reminder_rules` does
 * when the task is armed: the task's own → its template's (`tasks.template_id`) → its type's
 * `default_reminders` → the organisation's `default_task_reminders` → the launch schedule.
 */
export type ReminderLevels = {
  /** The template the task started from, when it has one (null: none, or not known here). */
  template: readonly ReminderRule[] | null;
  /** The task's type's default. */
  type: readonly ReminderRule[] | null;
  /** The organisation's default (Settings → Thresholds). */
  organisation: readonly ReminderRule[];
};

/**
 * What a task follows while its own list is empty ("Using the default"): the template's, else
 * the type's, else the organisation's, else the launch schedule.
 */
export function taskDefaultReminders(levels: ReminderLevels): readonly ReminderRule[] {
  return resolveReminders([levels.template, levels.type, levels.organisation]);
}

/** What a template follows while its own list is empty: its type's, else the organisation's. */
export function templateDefaultReminders(
  levels: Omit<ReminderLevels, "template">,
): readonly ReminderRule[] {
  return resolveReminders([levels.type, levels.organisation]);
}

/** What a task type follows while its own list is empty: the organisation's, else the launch one. */
export function typeDefaultReminders(
  organisation: readonly ReminderRule[],
): readonly ReminderRule[] {
  return resolveReminders([organisation]);
}
