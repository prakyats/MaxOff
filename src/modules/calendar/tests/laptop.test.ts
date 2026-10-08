import { describe, expect, it } from "vitest";

import { istInstant } from "@/core/time";

import type { EventItem } from "../domain/calendar";
import {
  agendaEvents,
  agendaTime,
  blockShowsClient,
  CLIENT_LINE_MINUTES,
  shortcutFor,
  type ShortcutKey,
} from "../domain/laptop";

/**
 * The laptop calendar's rules (decision 25 as amended by the owner 2026-10-08 for the laptop):
 * the day popup's agenda, the blocks' client line and the keyboard shortcuts.
 */

const TODAY = "2026-10-08";

function event(id: string, patch: Partial<EventItem> = {}): EventItem {
  return {
    kind: "event",
    id,
    title: `Event ${id}`,
    date: TODAY,
    startAt: istInstant(TODAY, "10:00"),
    endAt: istInstant(TODAY, "11:00"),
    location: null,
    clientName: null,
    typeName: "Shoot / Site Visit",
    color: "#2563eb",
    rank: 1,
    completed: false,
    people: [],
    ...patch,
  };
}

describe("the day popup's agenda", () => {
  it("says a time as the owner wrote it: 11:49–3:49", () => {
    expect(agendaTime(istInstant(TODAY, "11:49"), istInstant(TODAY, "15:49"))).toBe("11:49–3:49");
    expect(agendaTime(istInstant(TODAY, "09:05"), null)).toBe("9:05");
    expect(agendaTime(null, null)).toBe("All day");
  });

  it("lists the events in time order, the all-day ones first", () => {
    const late = event("late", { startAt: istInstant(TODAY, "16:00"), endAt: null });
    const early = event("early", { startAt: istInstant(TODAY, "08:30"), endAt: null });
    const allDay = event("all", { startAt: null, endAt: null, rank: 2 });
    const meeting = event("meet", { startAt: istInstant(TODAY, "08:30"), endAt: null, rank: 2 });
    expect(agendaEvents({ events: [late, meeting, allDay, early] }).map((e) => e.id)).toEqual([
      "all",
      "early",
      "meet",
      "late",
    ]);
  });
});

describe("an event block's client line", () => {
  it("shows under the title only when the block has room and there is a client", () => {
    expect(blockShowsClient(60, "Acme")).toBe(false);
    expect(blockShowsClient(CLIENT_LINE_MINUTES, "Acme")).toBe(true);
    expect(blockShowsClient(120, null)).toBe(false);
    expect(blockShowsClient(120, "")).toBe(false);
  });
});

describe("the keyboard shortcuts", () => {
  const press = (key: string, patch: Partial<ShortcutKey> = {}): ShortcutKey => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    inField: false,
    overlayOpen: false,
    ...patch,
  });

  it("moves with the arrows, goes to today with T, switches views with D, W and M", () => {
    expect(shortcutFor(press("ArrowLeft"))).toEqual({ kind: "move", direction: -1 });
    expect(shortcutFor(press("ArrowRight"))).toEqual({ kind: "move", direction: 1 });
    expect(shortcutFor(press("t"))).toEqual({ kind: "today" });
    expect(shortcutFor(press("T"))).toEqual({ kind: "today" });
    expect(shortcutFor(press("d"))).toEqual({ kind: "view", view: "day" });
    expect(shortcutFor(press("w"))).toEqual({ kind: "view", view: "week" });
    expect(shortcutFor(press("m"))).toEqual({ kind: "view", view: "month" });
    expect(shortcutFor(press("x"))).toBeNull();
    expect(shortcutFor(press("ArrowUp"))).toBeNull();
  });

  it("never acts with a modifier key, inside a field or while an overlay is open", () => {
    for (const modifier of ["ctrlKey", "metaKey", "altKey", "shiftKey"] as const) {
      expect(shortcutFor(press("ArrowLeft", { [modifier]: true }))).toBeNull();
      expect(shortcutFor(press("w", { [modifier]: true }))).toBeNull();
    }
    expect(shortcutFor(press("t", { inField: true }))).toBeNull();
    expect(shortcutFor(press("ArrowRight", { overlayOpen: true }))).toBeNull();
  });
});
