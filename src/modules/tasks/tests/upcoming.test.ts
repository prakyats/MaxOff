import { describe, expect, it } from "vitest";

import { istInstant } from "@/core/time";

import type { EventTask } from "../domain/dashboards";
import { rowMeta, type TaskListRow } from "../domain/lists";
import type { TaskState } from "../domain/types";
import {
  upcomingEvents,
  upcomingEventsUntil,
  upcomingIds,
  upcomingPeople,
  upcomingWhen,
} from "../domain/upcoming";

const TODAY = "2026-11-16";

function row(id: string, state: TaskState = "todo", title = id): TaskListRow {
  return {
    id,
    title,
    state,
    adminStep: "required",
    priority: "medium",
    dueAt: istInstant(TODAY, "18:00"),
    clientId: null,
    taskTypeId: "shoot",
    primaryOwnerId: "p",
    approvingAdminId: null,
    createdBy: "a",
    submittedAt: null,
    createdAt: istInstant(TODAY, "09:00"),
    assignees: [],
  };
}

function event(id: string, over: Partial<EventTask> = {}): EventTask {
  return {
    id,
    title: id,
    state: "todo",
    eventDate: TODAY,
    eventStartAt: istInstant(TODAY, "14:00"),
    eventEndAt: istInstant(TODAY, "16:00"),
    location: "Studio",
    clientId: null,
    taskTypeId: "shoot",
    primaryOwnerId: "p",
    assigneeIds: ["p"],
    ...over,
  };
}

describe("upcomingEvents", () => {
  it("keeps the open event tasks from today to six days ahead, soonest first", () => {
    const events = [
      event("later", { eventDate: "2026-11-22" }),
      event("too-late", { eventDate: "2026-11-23" }),
      event("past", { eventDate: "2026-11-15" }),
      event("afternoon"),
      event("morning", {
        eventStartAt: istInstant(TODAY, "11:00"),
        eventEndAt: istInstant(TODAY, "13:00"),
      }),
      event("all-day", { eventStartAt: null, eventEndAt: null }),
      event("done"),
      event("not-in-list"),
    ];
    const rows = ["later", "too-late", "past", "afternoon", "morning", "all-day"].map((id) =>
      row(id),
    );
    rows.push(row("done", "completed"));
    expect(upcomingEvents(events, rows, TODAY).map((item) => item.row.id)).toEqual([
      "all-day",
      "morning",
      "afternoon",
      "later",
    ]);
    expect(upcomingEventsUntil(TODAY)).toBe("2026-11-22");
  });

  it("keeps a held task (its row says On hold) and gives the ids the other lists leave out", () => {
    const held = { ...row("held"), heldAt: istInstant(TODAY, "08:00") };
    const upcoming = upcomingEvents([event("held")], [held], TODAY);
    expect(upcoming).toHaveLength(1);
    expect(upcomingIds(upcoming)).toEqual(new Set(["held"]));
  });
});

describe("upcomingWhen", () => {
  it("says the day, the time and the place", () => {
    expect(upcomingWhen(event("e"))).toBe("Mon 16 · 2:00 pm – 4:00 pm · Studio");
    expect(upcomingWhen(event("e", { eventStartAt: null, eventEndAt: null, location: "  " }))).toBe(
      "Mon 16 · All day",
    );
    expect(upcomingWhen(event("e", { eventEndAt: null, location: null }))).toBe(
      "Mon 16 · 2:00 pm – 3:00 pm",
    );
  });
});

describe("upcomingPeople", () => {
  const nameOf = (id: string) => ({ p: "PShetty", k: "Kiran", v: "you" })[id] ?? id;
  it("names the primary owner first, two names, then +N", () => {
    expect(upcomingPeople(event("e", { assigneeIds: ["k", "p"] }), nameOf)).toBe("PShetty, Kiran");
    expect(upcomingPeople(event("e", { assigneeIds: ["k", "v", "p", "x"] }), nameOf)).toBe(
      "PShetty, Kiran +2",
    );
    expect(upcomingPeople(event("e", { assigneeIds: [] }), nameOf)).toBeNull();
  });
});

describe("rowMeta with an event's lead (v6.5 Q6: My Day)", () => {
  it("says the event's day, time and place in place of the deadline", () => {
    const context = {
      viewerId: "p",
      nameOf: (id: string) => id,
      engagementOf: () => undefined,
      clientName: () => "Coastal Cafe",
    };
    const shoot = { ...row("e"), clientId: "c" };
    expect(rowMeta(shoot, context, upcomingWhen(event("e")))).toBe(
      "Mon 16 · 2:00 pm – 4:00 pm · Studio · Coastal Cafe",
    );
    expect(rowMeta(shoot, context)).toMatch(/^Due .* · Coastal Cafe$/);
  });
});
