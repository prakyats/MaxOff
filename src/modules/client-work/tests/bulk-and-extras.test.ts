import { describe, expect, it } from "vitest";

import { describeProjectActivity, type ActivityEntry } from "../domain/activity";
import { renamePreview, shiftDays, shiftWords } from "../domain/bulk";
import { cycleExtras, extrasCycle, extrasQuestion, type ExtraCandidate } from "../domain/extras";
import { scheduleDay, scheduleText, type ScheduleItem } from "../domain/schedule";

/** ROADMAP 6b.16 (c)(d)(e)(g): the pure rules behind the revision round, extras, bulk edits and the schedule. */

describe("renamePreview (the same rule as items_rename)", () => {
  const items = [
    { id: "a", title: "Item 3" },
    { id: "b", title: "Item 1" },
    { id: "c", title: "Item 2" },
  ];

  it("numbers {n} in the order given, from the start", () => {
    expect(renamePreview(" Piece {n} ", items, 5)).toEqual({
      ok: true,
      rows: [
        { id: "a", from: "Item 3", to: "Piece 5" },
        { id: "b", from: "Item 1", to: "Piece 6" },
        { id: "c", from: "Item 2", to: "Piece 7" },
      ],
    });
  });

  it("keeps the current title for {title}, replacing {n} first", () => {
    const preview = renamePreview("{title} v{n}", [{ id: "a", title: "Cut {n}" }]);
    expect(preview.ok && preview.rows[0]?.to).toBe("Cut {n} v1");
  });

  it("refuses one name for many, an empty name, a bad start and a name too long", () => {
    expect(renamePreview("Same", items)).toEqual({
      ok: false,
      issue: "Add {n} so each deliverable gets its own number.",
    });
    expect(renamePreview("Only", [items[0]!]).ok).toBe(true);
    expect(renamePreview("   ", items).ok).toBe(false);
    expect(renamePreview("X {n}", items, -1).ok).toBe(false);
    expect(renamePreview("X {n}", items, 10000).ok).toBe(false);
    expect(renamePreview(`${"x".repeat(200)}{n}`, items).ok).toBe(false);
  });
});

describe("shiftDays and shiftWords", () => {
  it("takes 1 to 365 days", () => {
    expect(shiftDays("3")).toEqual({ ok: true, days: 3 });
    expect(shiftDays(" 365 ")).toEqual({ ok: true, days: 365 });
    for (const bad of ["", "0", "366", "1.5", "x"]) expect(shiftDays(bad).ok).toBe(false);
  });

  it("says how far and which way", () => {
    expect(shiftWords(3, 2)).toBe("Moved 3 deliverables 2 days later");
    expect(shiftWords(1, -1)).toBe("Moved 1 deliverable 1 day earlier");
  });
});

describe("cycleExtras (the same rule as app.cycle_extras)", () => {
  const item = (over: Partial<ExtraCandidate> & { id: string; title: string }): ExtraCandidate => ({
    position: over.id,
    state: "open",
    cycleId: "c",
    originCycleId: "c",
    ...over,
  });

  it("keeps the ones added in the cycle that are not on the list, once per title, in order", () => {
    const items = [
      item({ id: "e", title: "Extra 2" }),
      item({ id: "a", title: "Line 1" }),
      item({ id: "b", title: " line 1 " }),
      item({ id: "c", title: "Extra 1" }),
      item({ id: "d", title: " EXTRA 1" }),
      item({ id: "f", title: "Closed", state: "cancelled" }),
      item({ id: "g", title: "Carried in", originCycleId: "earlier" }),
      item({ id: "h", title: "Other cycle", cycleId: "other", originCycleId: "other" }),
      item({ id: "i", title: "Done extra", state: "approved" }),
    ];
    expect(cycleExtras("c", items, ["Line 1"]).map((row) => row.title)).toEqual([
      "Extra 1",
      "Extra 2",
      "Done extra",
    ]);
  });
});

describe("extrasCycle: asked at the month's end, once", () => {
  const cycle = (periodEnd: string | null, extrasDecided = false) => ({ periodEnd, extrasDecided });

  it("from 6 days before a month's end to 7 days after", () => {
    const october = cycle("2026-10-31");
    expect(extrasCycle("monthly", [october], "2026-10-24")).toBeNull();
    expect(extrasCycle("monthly", [october], "2026-10-25")).toBe(october);
    expect(extrasCycle("monthly", [october], "2026-11-07")).toBe(october);
    expect(extrasCycle("monthly", [october], "2026-11-08")).toBeNull();
  });

  it("never once answered, never for a one-time project, the latest of two", () => {
    expect(extrasCycle("monthly", [cycle("2026-10-31", true)], "2026-10-31")).toBeNull();
    expect(extrasCycle("one_time", [cycle(null)], "2026-10-31")).toBeNull();
    const week1 = cycle("2026-10-18");
    const week2 = cycle("2026-10-25");
    expect(extrasCycle("weekly", [week1, week2], "2026-10-24")).toBe(week2);
    expect(extrasCycle("weekly", [week1], "2026-10-16")).toBe(null);
    expect(extrasCycle("weekly", [week1], "2026-10-20")).toBe(week1);
  });

  it("asks in the project's own words", () => {
    expect(extrasQuestion("monthly", "October 2026")).toBe(
      "Keep October 2026's extra deliverables next month?",
    );
    expect(extrasQuestion("weekly", null)).toBe("Keep this week's extra deliverables next week?");
  });
});

describe("scheduleText: a month as WhatsApp text", () => {
  const item = (
    id: string,
    title: string,
    plannedDate: string | null,
    state: ScheduleItem["state"] = "open",
  ): ScheduleItem => ({ id, title, position: id, plannedDate, state });

  it("days in IST, grouped and in order, the unplanned last, done ones said, closed ones left out", () => {
    expect(scheduleDay("2026-10-21")).toBe("Wed 21 Oct");
    expect(
      scheduleText({
        projectName: "Work",
        cycleLabel: "October 2026",
        items: [
          item("a", "Item 1", "2026-10-23"),
          item("b", "Item 2", "2026-10-21"),
          item("c", "Item 3", null),
          item("d", "Item 4", "2026-10-21", "approved"),
          item("e", "Item 5", "2026-10-22", "cancelled"),
          item("f", "Item 6", "2026-10-22", "carried"),
        ],
      }),
    ).toBe(
      [
        "*Work · October 2026*",
        "Wed 21 Oct\n• Item 2\n• Item 4 (done)",
        "Fri 23 Oct\n• Item 1",
        "Not planned yet\n• Item 3",
      ].join("\n\n"),
    );
  });

  it("says when there is nothing, and a one-time project has no month", () => {
    expect(scheduleText({ projectName: "Once", cycleLabel: null, items: [] })).toBe(
      "*Once*\n\nNo deliverables yet.",
    );
  });
});

describe("the history says the new entries", () => {
  const entry = (over: Partial<ActivityEntry>): ActivityEntry => ({
    id: 1,
    actorId: null,
    entity: "project_cycles",
    entityId: "p",
    action: "insert",
    old: {},
    new: {},
    meta: {},
    at: "2026-10-31T05:00:00Z",
    ...over,
  });
  const context = { names: {}, items: {}, stages: {} };

  it("a revision round, extras kept and not kept", () => {
    expect(
      describeProjectActivity(
        entry({
          entity: "project_item_stage_list",
          new: { name: "Revision 3", group_label: "Review" },
          meta: { revision_round: true },
        }),
        context,
      )?.text,
    ).toBe("added another revision round, Review · Revision 3, to a deliverable");
    expect(
      describeProjectActivity(
        entry({ action: "extras_kept", meta: { count: 2, label: "October 2026" } }),
        context,
      )?.text,
    ).toBe("kept October 2026's 2 extra deliverables in the deliverables list");
    expect(
      describeProjectActivity(
        entry({ action: "extras_not_kept", meta: { count: 0, label: "October 2026" } }),
        context,
      )?.text,
    ).toBe("left October 2026's extra deliverables off the deliverables list");
  });
});
