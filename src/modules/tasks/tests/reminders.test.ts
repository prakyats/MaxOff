import { describe, expect, it } from "vitest";

import { LAUNCH_REMINDERS, type ReminderRule } from "@/core/lib/reminder-rules";

import {
  addAssignee,
  draftChanges,
  draftFromTask,
  emptyDraft,
  fieldsFromTask,
  taskFromDraft,
  validateDraft,
} from "../domain/form";
import {
  taskDefaultReminders,
  templateDefaultReminders,
  typeDefaultReminders,
} from "../domain/reminders";
import type { Task, TaskType } from "../domain/types";

const TEMPLATE: ReminderRule[] = [{ before: 4, unit: "hours" }];
const TYPE: ReminderRule[] = [{ before: 3, unit: "days" }];
const ORG: ReminderRule[] = [{ before: 12, unit: "hours" }];

/**
 * 5.3: what "Using the default" names at each level, the order `app.task_reminder_rules`
 * resolves them in: the task's template, its type, the organisation, the launch schedule.
 */
describe("the default a level follows while its own list is empty", () => {
  it("a task: its template's, else its type's, else the organisation's, else the launch one", () => {
    expect(taskDefaultReminders({ template: TEMPLATE, type: TYPE, organisation: ORG })).toEqual(
      TEMPLATE,
    );
    expect(taskDefaultReminders({ template: [], type: TYPE, organisation: ORG })).toEqual(TYPE);
    expect(taskDefaultReminders({ template: null, type: [], organisation: ORG })).toEqual(ORG);
    expect(taskDefaultReminders({ template: null, type: null, organisation: [] })).toEqual(
      LAUNCH_REMINDERS,
    );
  });

  it("a template: its type's, else the organisation's, else the launch one", () => {
    expect(templateDefaultReminders({ type: TYPE, organisation: ORG })).toEqual(TYPE);
    expect(templateDefaultReminders({ type: [], organisation: ORG })).toEqual(ORG);
    expect(templateDefaultReminders({ type: null, organisation: [] })).toEqual(LAUNCH_REMINDERS);
  });

  it("a task type: the organisation's, else the launch one", () => {
    expect(typeDefaultReminders(ORG)).toEqual(ORG);
    expect(typeDefaultReminders([])).toEqual(LAUNCH_REMINDERS);
  });
});

const NORMAL: TaskType = {
  id: "normal",
  name: "Normal",
  kind: "normal",
  hasLocation: false,
  archived: false,
  defaultReminders: TYPE,
};
const NOW = new Date("2026-10-01T06:00:00.000Z");

function filled() {
  return {
    ...addAssignee(emptyDraft(), "asha"),
    title: "Reel edit",
    taskTypeId: "normal",
    dueDate: "2026-10-03",
  };
}

function task(reminderRules: ReminderRule[]): Task {
  return {
    id: "t",
    title: "Reel edit",
    description: null,
    taskTypeId: "normal",
    clientId: null,
    priority: "medium",
    dueAt: "2026-10-03T12:30:00+00:00",
    eventDate: null,
    eventStartAt: null,
    eventEndAt: null,
    location: null,
    purpose: null,
    state: "todo",
    approvingAdminId: null,
    adminStep: "none",
    createdBy: "owner",
    primaryOwnerId: "asha",
    lateReason: null,
    cancelledReason: null,
    customFields: {},
    submittedAt: null,
    submittedBy: null,
    submittedOnBehalfOf: null,
    adminApprovedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: "2026-10-01T00:00:00Z",
    reminderRules,
    templateId: null,
  };
}

const ASSIGNEES = [
  {
    memberId: "asha",
    isPrimary: true,
    assignedAt: "x",
    acknowledgedAt: null,
    acknowledgedBy: null,
    removedAt: null,
  },
];

describe("the task dialog's reminders", () => {
  it("a new task keeps the default: it sends [] (never the type's list, never left out)", () => {
    const draft = filled();
    expect(draft.reminders).toBeNull();
    expect(taskFromDraft(draft, NORMAL).reminderRules).toEqual([]);
  });

  it("sends the rows as the task's own list once they are edited", () => {
    const draft = {
      ...filled(),
      reminders: [
        { before: "1", unit: "days" as const },
        { before: "0", unit: "minutes" as const },
      ],
    };
    expect(taskFromDraft(draft, NORMAL).reminderRules).toEqual([
      { before: 1, unit: "days" },
      { before: 0, unit: "minutes" },
    ]);
  });

  it("refuses to send while a row needs fixing", () => {
    const draft = { ...filled(), reminders: [{ before: "1.5", unit: "hours" as const }] };
    expect(validateDraft(draft, NORMAL, { creating: true, now: NOW }).reminders).toBe(
      "Fix the reminders, or use the default.",
    );
    expect(validateDraft(filled(), NORMAL, { creating: true, now: NOW }).reminders).toBeUndefined();
  });

  it("an edit opens on the task's own list, or 'using the default' for []", () => {
    expect(draftFromTask(task([]), ASSIGNEES).reminders).toBeNull();
    expect(draftFromTask(task(TEMPLATE), ASSIGNEES).reminders).toEqual([
      { before: "4", unit: "hours" },
    ]);
  });

  it("an edit sends the reminders only when they changed", () => {
    const own = task(TEMPLATE);
    const before = fieldsFromTask(own, ASSIGNEES);
    const same = draftFromTask(own, ASSIGNEES);
    expect(draftChanges(before, taskFromDraft(same, NORMAL))).toEqual({});

    const changed = { ...same, reminders: [{ before: "2", unit: "hours" as const }] };
    expect(draftChanges(before, taskFromDraft(changed, NORMAL))).toEqual({
      reminderRules: [{ before: 2, unit: "hours" }],
    });

    // "Use the default" clears the task's own list.
    expect(draftChanges(before, taskFromDraft({ ...same, reminders: null }, NORMAL))).toEqual({
      reminderRules: [],
    });
  });
});
