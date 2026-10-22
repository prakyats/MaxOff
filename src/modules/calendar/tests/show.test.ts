import { describe, expect, it } from "vitest";

import type { CalendarDay, ClientItemEntry } from "../domain/calendar";
import { clientWorkRows, parseShow, shownDay, showsSwitch } from "../domain/show";
import { allStrips } from "../domain/strips";

/**
 * The calendar's All · Tasks · Client work switch and the day's client work (SCOPE §6, the
 * approved calendar sample).
 */

const TODAY = "2026-10-22";

function item(id: string, client: string, title: string, done = false): ClientItemEntry {
  return { kind: "item", id, title, project: "October", client, href: `/x/${id}`, done };
}

function day(patch: Partial<CalendarDay> = {}): CalendarDay {
  return {
    date: TODAY,
    holiday: "Diwali",
    weeklyOff: false,
    leave: [
      { memberId: "a", name: "Asha", label: "On leave", half: false, own: false, pending: false },
    ],
    events: [
      {
        id: "e",
        title: "Shoot",
        startAt: "2026-10-22T04:30:00.000Z",
        endAt: null,
        color: "#2563eb",
        rank: 1,
        completed: false,
        location: null,
        clientName: null,
        people: [],
        typeName: null,
      },
    ],
    busy: [{ memberId: "b", name: "Ravi", startAt: "2026-10-22T05:30:00.000Z", endAt: null }],
    due: [
      {
        id: "t",
        title: "Edit",
        dueAt: "2026-10-22T12:30:00.000Z",
        owner: "Asha",
        color: "#7c3aed",
      },
    ],
    items: [item("i", "Shetty", "Reel 1")],
    ...patch,
  } as CalendarDay;
}

describe("the All · Tasks · Client work switch", () => {
  it("is the Owner's and Admins', never Crew's", () => {
    expect(showsSwitch("owner")).toBe(true);
    expect(showsSwitch("admin")).toBe(true);
    expect(showsSwitch("staff")).toBe(false);
  });

  it("reads back a stored choice, anything unknown as All", () => {
    expect(parseShow("tasks")).toBe("tasks");
    expect(parseShow("client")).toBe("client");
    expect(parseShow("all")).toBe("all");
    expect(parseShow(null)).toBe("all");
    expect(parseShow("deliverables")).toBe("all");
  });

  it("Tasks hides the client work; Client work hides the tasks; leave and holidays always stay", () => {
    const tasks = shownDay(day(), "tasks");
    expect(tasks.items).toEqual([]);
    expect(tasks.events).toHaveLength(1);
    expect(tasks.due).toHaveLength(1);
    const client = shownDay(day(), "client");
    expect(client.events).toEqual([]);
    expect(client.busy).toEqual([]);
    expect(client.due).toEqual([]);
    expect(client.items).toHaveLength(1);
    for (const shown of [tasks, client, shownDay(day(), "all")]) {
      expect(shown.holiday).toBe("Diwali");
      expect(shown.leave).toHaveLength(1);
    }
    expect(shownDay(day(), "all")).toEqual(day());
  });
});

describe("a day's client work", () => {
  it("comes after the tasks in a box: timed tasks, due tasks, client work, then the rest", () => {
    expect(allStrips(day(), TODAY).map((strip) => strip.kind)).toEqual([
      "event",
      "due",
      "item",
      "holiday",
      "busy",
      "leave",
    ]);
  });

  it("is late only on a past day", () => {
    const [today] = allStrips(
      day({ events: [], due: [], busy: [], holiday: null, leave: [] }),
      TODAY,
    );
    expect(today).toMatchObject({ kind: "item", label: "Shetty · Reel 1", late: false });
    const [past] = allStrips(
      day({ date: "2026-10-21", events: [], due: [], busy: [], holiday: null, leave: [] }),
      TODAY,
    );
    expect(past).toMatchObject({ kind: "item", late: true });
  });

  it("is grouped by client in the popup, the open work first within each", () => {
    const rows = clientWorkRows([
      item("1", "Yamuna", "Poster 3", true),
      item("2", "Shetty", "Yesss test"),
      item("3", "Yamuna", "Interview 2"),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["2", "3", "1"]);
  });
});
