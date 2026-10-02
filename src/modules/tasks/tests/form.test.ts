import { describe, expect, it } from "vitest";

import {
  addAssignee,
  assignmentChange,
  draftChanges,
  draftEventWindow,
  draftFromTask,
  draftType,
  emptyDraft,
  fieldsFromTask,
  isDraftDirty,
  keepFieldKeys,
  removeAssignee,
  taskFromDraft,
  validateDraft,
} from "../domain/form";
import type { Task, TaskType } from "../domain/types";

const NORMAL: TaskType = {
  id: "normal",
  name: "Normal",
  kind: "normal",
  hasLocation: false,
  archived: false,
  defaultReminders: [],
};
const SHOOT: TaskType = {
  id: "shoot",
  name: "Shoot / Site Visit",
  kind: "event",
  hasLocation: true,
  archived: false,
  defaultReminders: [],
};
const POSTING: TaskType = {
  id: "posting",
  name: "Posting",
  kind: "event",
  hasLocation: false,
  archived: false,
  defaultReminders: [],
};
const NOW = new Date("2026-10-01T06:00:00.000Z"); // 11:30 IST, 1 Oct

function filled() {
  return {
    ...addAssignee(emptyDraft(), "asha"),
    title: " Reel edit ",
    dueDate: "2026-10-03",
  };
}

describe("the task dialog's draft (4.3)", () => {
  it("defaults to Medium and 6:00 PM IST, and to the first active type", () => {
    const draft = emptyDraft();
    expect(draft.priority).toBe("medium");
    expect(draft.dueTime).toBe("18:00");
    expect(draftType(draft, [{ ...NORMAL, archived: true, id: "old" }, NORMAL, SHOOT])).toBe(
      NORMAL,
    );
    expect(draftType({ ...draft, taskTypeId: "shoot" }, [NORMAL, SHOOT])).toBe(SHOOT);
  });

  it("makes the first person the primary owner, and hands over when they leave", () => {
    let draft = addAssignee(emptyDraft(), "asha");
    draft = addAssignee(draft, "ravi");
    draft = addAssignee(draft, "asha");
    expect(draft.assigneeIds).toEqual(["asha", "ravi"]);
    expect(draft.primaryOwnerId).toBe("asha");
    draft = removeAssignee(draft, "asha");
    expect(draft).toMatchObject({ assigneeIds: ["ravi"], primaryOwnerId: "ravi" });
    expect(removeAssignee(draft, "ravi").primaryOwnerId).toBe("");
  });

  it("asks for a title, a person and a future deadline", () => {
    const errors = validateDraft(emptyDraft(), NORMAL, { creating: true, now: NOW });
    expect(errors).toMatchObject({
      title: "Give the task a title.",
      assigneeIds: "Assign at least one person.",
      dueDate: "Pick the deadline's date.",
    });
    const past = { ...filled(), dueDate: "2026-10-01", dueTime: "09:00" };
    expect(validateDraft(past, NORMAL, { creating: true, now: NOW }).dueDate).toMatch(
      /already passed/,
    );
    // An edit may move the deadline anywhere (kickoff 4 decision 4).
    expect(validateDraft(past, NORMAL, { creating: false, now: NOW }).dueDate).toBeUndefined();
    expect(validateDraft(filled(), NORMAL, { creating: true, now: NOW })).toEqual({});
  });

  it("asks an event for its date and a sane window", () => {
    const event = { ...filled(), taskTypeId: "shoot" };
    expect(validateDraft(event, SHOOT, { creating: true, now: NOW }).eventDate).toBe(
      "Pick the event's date.",
    );
    const backwards = { ...event, eventDate: "2026-10-02", eventStart: "12:00", eventEnd: "10:00" };
    expect(validateDraft(backwards, SHOOT, { creating: true, now: NOW }).eventEnd).toBe(
      "The event ends after it starts.",
    );
    const endOnly = { ...event, eventDate: "2026-10-02", eventEnd: "10:00" };
    expect(validateDraft(endOnly, SHOOT, { creating: true, now: NOW }).eventStart).toBeDefined();
  });

  it("sends instants in IST and only what the type carries", () => {
    const draft = {
      ...filled(),
      taskTypeId: "posting",
      eventDate: "2026-10-02",
      eventStart: "10:00",
      location: "Studio",
      purpose: " Launch post ",
      clientId: "",
      description: "  ",
    };
    const fields = taskFromDraft(draft, POSTING);
    expect(fields).toMatchObject({
      title: "Reel edit",
      description: null,
      clientId: null,
      dueAt: "2026-10-03T12:30:00.000Z",
      eventDate: "2026-10-02",
      eventStartAt: "2026-10-02T04:30:00.000Z",
      eventEndAt: null,
      // Posting has no location (4A mechanics 6).
      location: null,
      purpose: "Launch post",
    });
    expect(taskFromDraft({ ...draft, taskTypeId: "normal" }, NORMAL)).toMatchObject({
      eventDate: null,
      eventStartAt: null,
      purpose: null,
    });
    expect(draftEventWindow(draft, POSTING)).toEqual({
      startAt: "2026-10-02T04:30:00.000Z",
      endAt: "2026-10-02T05:30:00.000Z",
    });
    expect(draftEventWindow(draft, NORMAL)).toBeNull();
  });
});

describe("an edit sends only what changed (4A mechanics 4)", () => {
  const existing: Task = {
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
    customFields: { reel_length: 30 },
    submittedAt: null,
    submittedBy: null,
    submittedOnBehalfOf: null,
    adminApprovedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: "2026-10-01T00:00:00Z",
    reminderRules: [],
    templateId: null,
  };
  const assignees = [
    {
      memberId: "asha",
      isPrimary: true,
      assignedAt: "x",
      acknowledgedAt: null,
      acknowledgedBy: null,
      removedAt: null,
    },
    {
      memberId: "gone",
      isPrimary: false,
      assignedAt: "x",
      acknowledgedAt: null,
      acknowledgedBy: null,
      removedAt: "y",
    },
  ];

  it("starts from the task as it stands and finds nothing changed", () => {
    const draft = draftFromTask(existing, assignees);
    expect(draft).toMatchObject({ dueDate: "2026-10-03", dueTime: "18:00", assigneeIds: ["asha"] });
    const before = fieldsFromTask(existing, assignees);
    expect(draftChanges(before, taskFromDraft(draft, NORMAL))).toEqual({});
    expect(isDraftDirty(draft, { ...draft })).toBe(false);
    expect(isDraftDirty(draft, { ...draft, title: "Reel edit v2" })).toBe(true);
  });

  it("names the moved deadline, the new person and the priority", () => {
    const draft = draftFromTask(existing, assignees);
    const after = taskFromDraft(
      { ...addAssignee(draft, "ravi"), dueTime: "19:00", priority: "high" },
      NORMAL,
    );
    const before = fieldsFromTask(existing, assignees);
    expect(draftChanges(before, after)).toEqual({
      priority: "high",
      dueAt: "2026-10-03T13:30:00.000Z",
      assigneeIds: ["asha", "ravi"],
    });
    expect(assignmentChange(before, after)).toEqual({ added: ["ravi"], datesMoved: false });
    const nextDay = taskFromDraft({ ...draft, dueDate: "2026-10-04" }, NORMAL);
    expect(assignmentChange(before, nextDay).datesMoved).toBe(true);
  });

  it("a title-only edit of a timed event moves no dates (4B review S1)", () => {
    // PostgREST writes `+00:00`; the dialog's instants are `….000Z`: the same moments.
    const shoot: Task = {
      ...existing,
      taskTypeId: "shoot",
      eventDate: "2026-10-02",
      eventStartAt: "2026-10-02T04:30:00+00:00",
      eventEndAt: "2026-10-02T06:30:00+00:00",
    };
    const before = fieldsFromTask(shoot, assignees);
    const draft = draftFromTask(shoot, assignees);
    const after = taskFromDraft({ ...draft, title: "Reel shoot, day 2" }, SHOOT);
    expect(draftChanges(before, after)).toEqual({ title: "Reel shoot, day 2" });
    expect(assignmentChange(before, after)).toEqual({ added: [], datesMoved: false });
    const later = taskFromDraft({ ...draft, eventStart: "11:00" }, SHOOT);
    expect(assignmentChange(before, later).datesMoved).toBe(true);
  });

  it("drops custom-field values the new type does not carry", () => {
    expect(keepFieldKeys({ reel_length: 30, venue: "x" }, ["venue"])).toEqual({ venue: "x" });
  });
});
