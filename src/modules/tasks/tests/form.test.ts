import { describe, expect, it } from "vitest";

import {
  addAssignee,
  assignmentChange,
  canStartTaskOnDate,
  deadlineError,
  draftChanges,
  draftEventWindow,
  draftFromTask,
  draftType,
  draftOnDate,
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
  showsOnCalendar: false,
  archived: false,
  defaultReminders: [],
  color: null,
};
const SHOOT: TaskType = {
  id: "shoot",
  name: "Shoot / Site Visit",
  kind: "event",
  hasLocation: true,
  showsOnCalendar: true,
  archived: false,
  defaultReminders: [],
  color: null,
};
const POSTING: TaskType = {
  id: "posting",
  name: "Posting",
  kind: "event",
  hasLocation: false,
  showsOnCalendar: true,
  archived: false,
  defaultReminders: [],
  color: null,
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
    expect(validateDraft(past, NORMAL, { creating: true, now: NOW }).dueDate).toBe(
      "Pick a time later than now.",
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

describe("a new task started on a calendar day (6.4b, Kickoff 6 decision 25 D)", () => {
  it("puts the deadline on that day at 6:00 PM IST, and an event on that day", () => {
    // 11:30 IST on 8 Oct: today's 6:00 PM is still ahead.
    const draft = draftOnDate("2026-10-08", new Date("2026-10-08T06:00:00.000Z"));
    expect(draft).toEqual({ ...emptyDraft(), dueDate: "2026-10-08", eventDate: "2026-10-08" });
    expect(draft.dueTime).toBe("18:00");
    // A normal type sends the deadline only; an event type the event's date as well.
    const fields = { ...draft, title: "Reel", assigneeIds: ["m"], primaryOwnerId: "m" };
    expect(taskFromDraft(fields, NORMAL)).toMatchObject({
      dueAt: "2026-10-08T12:30:00.000Z",
      eventDate: null,
    });
    expect(taskFromDraft(fields, SHOOT)).toMatchObject({
      dueAt: "2026-10-08T12:30:00.000Z",
      eventDate: "2026-10-08",
    });
  });

  it("today after 6:00 PM IST, puts the deadline at the next whole hour instead", () => {
    // 18:00 IST exactly: 6:00 PM is not later than now, so 7:00 PM.
    expect(draftOnDate("2026-10-08", new Date("2026-10-08T12:30:00.000Z")).dueTime).toBe("19:00");
    // 20:40 IST → 9:00 PM.
    expect(draftOnDate("2026-10-08", new Date("2026-10-08T15:10:00.000Z")).dueTime).toBe("21:00");
    // 23:15 IST: the next hour is tomorrow, so the day's last minute.
    expect(draftOnDate("2026-10-08", new Date("2026-10-08T17:45:00.000Z")).dueTime).toBe("23:59");
    // A later day keeps 6:00 PM whatever the time now.
    expect(draftOnDate("2026-10-09", new Date("2026-10-08T15:10:00.000Z")).dueTime).toBe("18:00");
    // Whatever it prefills is later than now.
    for (const now of ["2026-10-08T12:30:00.000Z", "2026-10-08T17:45:00.000Z"]) {
      const draft = draftOnDate("2026-10-08", new Date(now));
      expect(deadlineError(draft, { creating: true, now: new Date(now) })).toBeNull();
    }
  });

  it("at 23:58 IST still offers today, at 11:59 PM, later than now", () => {
    // 23:58:59 IST on 8 Oct = 18:28:59 UTC.
    const now = new Date("2026-10-08T18:28:59.000Z");
    expect(canStartTaskOnDate("2026-10-08", now)).toBe(true);
    const draft = draftOnDate("2026-10-08", now);
    expect(draft.dueTime).toBe("23:59");
    expect(deadlineError(draft, { creating: true, now })).toBeNull();
  });

  it("from 23:59 IST offers no new task today: the day has no valid deadline left", () => {
    // 23:59:00 and 23:59:59 IST on 8 Oct: 11:59 PM is not later than now.
    for (const now of ["2026-10-08T18:29:00.000Z", "2026-10-08T18:29:59.000Z"]) {
      expect(canStartTaskOnDate("2026-10-08", new Date(now))).toBe(false);
      // What the form would have prefilled is refused by its own check, which is why it is not
      // offered at all.
      const draft = draftOnDate("2026-10-08", new Date(now));
      expect(deadlineError(draft, { creating: true, now: new Date(now) })).not.toBeNull();
      // Tomorrow is offered, and its prefill is later than now.
      expect(canStartTaskOnDate("2026-10-09", new Date(now))).toBe(true);
      const tomorrow = draftOnDate("2026-10-09", new Date(now));
      expect(tomorrow.dueTime).toBe("18:00");
      expect(deadlineError(tomorrow, { creating: true, now: new Date(now) })).toBeNull();
    }
  });

  it("offers no day before today (the same rule)", () => {
    // 00:10 IST on 9 Oct: 8 Oct is gone.
    const now = new Date("2026-10-08T18:40:00.000Z");
    expect(canStartTaskOnDate("2026-10-08", now)).toBe(false);
    expect(canStartTaskOnDate("2026-10-01", now)).toBe(false);
    expect(canStartTaskOnDate("2026-10-09", now)).toBe(true);
  });

  it("whatever a day it offers prefills is later than now, minute by minute through the evening", () => {
    // Every minute from 17:00 to 23:59 IST on 8 Oct.
    const start = Date.parse("2026-10-08T11:30:00.000Z");
    for (let minute = 0; minute < 7 * 60; minute += 1) {
      const now = new Date(start + minute * 60_000);
      if (!canStartTaskOnDate("2026-10-08", now)) continue;
      const draft = draftOnDate("2026-10-08", now);
      expect(deadlineError(draft, { creating: true, now })).toBeNull();
    }
  });
});

describe("the deadline's own check while it is picked (kickoff 4 decision 4)", () => {
  it("asks a new task for a time later than now, and lets an edit move it anywhere", () => {
    // NOW is 11:30 IST on 1 Oct.
    const pick = (dueDate: string, dueTime: string, creating = true) =>
      deadlineError({ dueDate, dueTime }, { creating, now: NOW });
    expect(pick("2026-10-01", "11:30")).toBe("Pick a time later than now.");
    expect(pick("2026-10-01", "09:00")).toBe("Pick a time later than now.");
    expect(pick("2026-09-30", "18:00")).toBe("Pick a time later than now.");
    expect(pick("2026-10-01", "11:31")).toBeNull();
    expect(pick("2026-10-02", "09:00")).toBeNull();
    expect(pick("2026-09-30", "18:00", false)).toBeNull();
    // Nothing to say until both a date and a time are picked.
    expect(pick("", "09:00")).toBeNull();
    expect(pick("2026-09-30", "")).toBeNull();
  });
});
