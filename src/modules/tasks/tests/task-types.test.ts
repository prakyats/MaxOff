import { describe, expect, it } from "vitest";

import { addTaskTypeSchema, editTaskTypeSchema } from "../domain/schemas";
import {
  isLastActiveType,
  splitTaskTypes,
  taskTypeLine,
  type TaskTypeSetting,
} from "../domain/task-types";

function type(overrides: Partial<TaskTypeSetting>): TaskTypeSetting {
  return {
    id: "t",
    name: "Normal",
    kind: "normal",
    showsOnCalendar: false,
    hasLocation: false,
    archivedAt: null,
    position: "a0",
    defaultReminders: [],
    ...overrides,
  };
}

describe("Settings → Task types (4C)", () => {
  it("names a type by its kind, and an event by where it shows and what it asks", () => {
    expect(taskTypeLine(type({}))).toBe("Normal");
    expect(taskTypeLine(type({ kind: "custom" }))).toBe("Custom");
    expect(taskTypeLine(type({ kind: "event", showsOnCalendar: true, hasLocation: true }))).toBe(
      "Event · on the calendar · asks for a location",
    );
    expect(taskTypeLine(type({ kind: "event" }))).toBe("Event · not on the calendar");
  });

  it("keeps the last active type", () => {
    const types = [type({ id: "a" }), type({ id: "b", archivedAt: "2026-09-29T00:00:00Z" })];
    expect(isLastActiveType(types, "a")).toBe(true);
    expect(isLastActiveType([...types, type({ id: "c" })], "a")).toBe(false);
    expect(isLastActiveType(types, "b")).toBe(false);
  });

  it("lists the active types in the Owner's order and the archived ones by name", () => {
    const { active, archived } = splitTaskTypes([
      type({ id: "2", name: "Meeting", position: "a2" }),
      type({ id: "0", name: "Normal", position: "a0" }),
      type({ id: "z", name: "Zoom", archivedAt: "2026-09-29T00:00:00Z" }),
      type({ id: "b", name: "Blog", archivedAt: "2026-09-29T00:00:00Z" }),
    ]);
    expect(active.map((t) => t.name)).toEqual(["Normal", "Meeting"]);
    expect(archived.map((t) => t.name)).toEqual(["Blog", "Zoom"]);
  });

  it("gives the calendar and location switches to an event only", () => {
    expect(
      addTaskTypeSchema.parse({
        name: " Podcast ",
        kind: "normal",
        showsOnCalendar: true,
        hasLocation: true,
      }),
    ).toEqual({
      name: "Podcast",
      kind: "normal",
      showsOnCalendar: false,
      hasLocation: false,
      defaultReminders: [],
    });
    expect(
      addTaskTypeSchema.parse({ name: "Recce", kind: "event", showsOnCalendar: true }),
    ).toEqual({
      name: "Recce",
      kind: "event",
      showsOnCalendar: true,
      hasLocation: false,
      defaultReminders: [],
    });
    expect(addTaskTypeSchema.safeParse({ name: "", kind: "normal" }).success).toBe(false);
    expect(addTaskTypeSchema.safeParse({ name: "x", kind: "project" }).success).toBe(false);
  });

  it("never changes the kind on an edit", () => {
    const parsed = editTaskTypeSchema.parse({
      taskTypeId: "00000000-0000-4000-8000-000000000001",
      name: "Shoot",
      kind: "normal",
      defaultReminders: [{ before: 6, unit: "hours" }],
    });
    expect(parsed).not.toHaveProperty("kind");
    expect(parsed.defaultReminders).toEqual([{ before: 6, unit: "hours" }]);
  });

  it("checks a type's default reminders as every level's (5.3)", () => {
    const edit = { taskTypeId: "00000000-0000-4000-8000-000000000001", name: "Shoot" };
    expect(editTaskTypeSchema.safeParse({ ...edit, defaultReminders: [] }).success).toBe(true);
    expect(
      editTaskTypeSchema.safeParse({
        ...edit,
        defaultReminders: [{ before: 61, unit: "days" }],
      }).error?.issues[0],
    ).toMatchObject({
      path: ["defaultReminders", 0, "before"],
      message: "Up to 60 days before the deadline.",
    });
    expect(
      editTaskTypeSchema.safeParse({
        ...edit,
        defaultReminders: [1, 2, 3, 4, 5, 6].map((before) => ({ before, unit: "days" })),
      }).error?.issues[0]?.message,
    ).toBe("Up to 5 reminders.");
  });
});
