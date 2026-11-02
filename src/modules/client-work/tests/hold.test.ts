import { describe, expect, it } from "vitest";

import type { ISODate } from "@/core/time";

import { describeProjectActivity, type ActivityEntry } from "../domain/activity";
import {
  isProjectOnHold,
  needsNewDate,
  onHoldDeliverablesLine,
  resumeItemsPayload,
  resumeProblems,
  type ResumeEntry,
  type ResumeRow,
} from "../domain/hold";

/** On hold, for projects (v1.9 W7; WORKFLOWS §5.5): the resume sheet's rules, as project_resume's. */

const TODAY = "2026-11-02" as ISODate;

function row(itemId: string, over: Partial<ResumeRow> = {}): ResumeRow {
  return {
    itemId,
    title: itemId,
    cycleLabel: "November 2026",
    plannedDate: null,
    monthEnded: false,
    needsDate: false,
    leftPending: false,
    carryForwardAllowed: true,
    ...over,
  };
}

// The approved sample: Reel 3 and Carousel 2 passed their dates this month; Reel 2's September ended.
const ROWS: ResumeRow[] = [
  row("Reel 3", { plannedDate: "2026-11-01" as ISODate, needsDate: true }),
  row("Carousel 2", { plannedDate: "2026-10-30" as ISODate, needsDate: true }),
  row("Reel 2", { cycleLabel: "September 2026", monthEnded: true }),
  row("Reel 4", {
    cycleLabel: "October 2026",
    monthEnded: true,
    plannedDate: "2026-10-20" as ISODate,
    leftPending: true,
  }),
];

const GOOD: ResumeEntry[] = [
  { itemId: "Reel 3", plannedDate: "2026-11-04" as ISODate },
  { itemId: "Carousel 2", plannedDate: "2026-11-06" as ISODate },
  { itemId: "Reel 2", decision: "carry_forward" },
  { itemId: "Reel 4", decision: "leave_pending", plannedDate: "2026-11-09" as ISODate },
];

const messages = (entries: readonly ResumeEntry[], rows: readonly ResumeRow[] = ROWS) =>
  resumeProblems(rows, entries, TODAY).map((problem) => problem.message);

describe("what the resume asks of each deliverable", () => {
  it("a running month's passed date: a new date", () => {
    expect(needsNewDate(ROWS[0]!, null, TODAY)).toBe(true);
  });

  it("an ended month: a choice, and a new date only when left pending past its date", () => {
    expect(needsNewDate(ROWS[2]!, "carry_forward", TODAY)).toBe(false);
    expect(needsNewDate(ROWS[3]!, "leave_pending", TODAY)).toBe(true);
    expect(needsNewDate(ROWS[3]!, "close", TODAY)).toBe(false);
    expect(needsNewDate(ROWS[2]!, "leave_pending", TODAY)).toBe(false);
  });
});

describe("resumeProblems (the transaction refuses the same)", () => {
  it("accepts every date and choice in one go", () => {
    expect(messages(GOOD)).toEqual([]);
  });

  it("refuses a passed date left without a new one", () => {
    expect(messages(GOOD.filter((entry) => entry.itemId !== "Reel 3"))).toEqual([
      "Reel 3: give it a new date.",
    ]);
  });

  it("refuses an ended month left undecided", () => {
    expect(messages(GOOD.filter((entry) => entry.itemId !== "Reel 2"))).toEqual([
      "Reel 2: choose carry forward, close or leave pending.",
    ]);
  });

  it("refuses leave pending with a passed date and no new one", () => {
    expect(
      messages([
        ...GOOD.filter((entry) => entry.itemId !== "Reel 4"),
        { itemId: "Reel 4", decision: "leave_pending" },
      ]),
    ).toEqual(["Reel 4: give it a new date."]);
  });

  it("refuses a date in the past", () => {
    expect(
      messages([
        ...GOOD.filter((entry) => entry.itemId !== "Reel 3"),
        { itemId: "Reel 3", plannedDate: "2026-11-01" as ISODate },
      ]),
    ).toEqual(["Reel 3: choose a date from today on."]);
  });

  it("refuses a close without a reason, or with a date", () => {
    const rest = GOOD.filter((entry) => entry.itemId !== "Reel 2");
    expect(messages([...rest, { itemId: "Reel 2", decision: "close" }])).toEqual([
      "Say why Reel 2 is closed.",
    ]);
    expect(
      messages([
        ...rest,
        {
          itemId: "Reel 2",
          decision: "close",
          reason: "Moved",
          closeKind: "not_needed",
          plannedDate: "2026-11-05" as ISODate,
        },
      ]),
    ).toEqual(["Reel 2: a closed deliverable takes no new date."]);
    expect(
      messages([
        ...rest,
        { itemId: "Reel 2", decision: "close", reason: "Moved", closeKind: "not_delivered" },
      ]),
    ).toEqual([]);
  });

  it("refuses a choice on a running month's deliverable", () => {
    expect(
      messages([
        ...GOOD.filter((entry) => entry.itemId !== "Reel 3"),
        { itemId: "Reel 3", decision: "close", reason: "x" },
      ]),
    ).toEqual([
      "Reel 3: its period has not ended, so it takes a new date only.",
      "Reel 3: give it a new date.",
    ]);
  });

  it("refuses carry forward on a closed client", () => {
    const rows = ROWS.map((r) => (r.monthEnded ? { ...r, carryForwardAllowed: false } : r));
    expect(messages(GOOD, rows)).toEqual([
      "Reel 2: the client is closed, so close it or leave it pending.",
    ]);
  });

  it("refuses an entry not listed, or listed twice", () => {
    expect(messages([...GOOD, { itemId: "Reel 9", plannedDate: "2026-11-05" as ISODate }])).toEqual(
      ["Only the deliverables listed for the resume take a new date or a choice."],
    );
    expect(messages([...GOOD, { itemId: "Reel 3", plannedDate: "2026-11-05" as ISODate }])).toEqual(
      ["A deliverable is listed twice."],
    );
  });
});

describe("the payload and the words", () => {
  it("sends the database's names, only what was given", () => {
    expect(
      resumeItemsPayload([
        { itemId: "a", plannedDate: "2026-11-04" as ISODate },
        { itemId: "b", decision: "close", reason: "  Moved ", closeKind: "not_needed" },
        { itemId: "c", decision: "carry_forward", reason: "  " },
      ]),
    ).toEqual([
      { item_id: "a", planned_date: "2026-11-04" },
      { item_id: "b", decision: "close", reason: "Moved", close_kind: "not_needed" },
      { item_id: "c", decision: "carry_forward" },
    ]);
  });

  it('reads "On hold · n deliverables", nothing at zero', () => {
    expect(onHoldDeliverablesLine(0)).toBeNull();
    expect(onHoldDeliverablesLine(1)).toBe("On hold · 1 deliverable");
    expect(onHoldDeliverablesLine(3)).toBe("On hold · 3 deliverables");
    expect(isProjectOnHold({ heldAt: "2026-10-20T04:30:00Z" })).toBe(true);
    expect(isProjectOnHold({ heldAt: null })).toBe(false);
  });
});

describe("the project's history says the hold and the resume", () => {
  const entry = (over: Partial<ActivityEntry>): ActivityEntry => ({
    id: 1,
    actorId: "owner",
    entity: "projects",
    entityId: "p",
    action: "held",
    old: {},
    new: {},
    meta: {},
    at: "2026-10-20T04:30:00Z",
    ...over,
  });
  const context = { names: { owner: "Prishit" }, items: {}, stages: {} };

  it("puts it on hold with the reason, and resumes it", () => {
    expect(
      describeProjectActivity(entry({ meta: { reason: "Client paused content" } }), context),
    ).toMatchObject({ text: "put the project on hold", note: "Client paused content" });
    expect(describeProjectActivity(entry({ action: "resumed" }), context)?.text).toBe(
      "resumed the project",
    );
    expect(
      describeProjectActivity(
        entry({
          action: "resumed",
          old: { delivery_date: "2026-11-01" },
          new: { delivery_date: "2026-11-09" },
        }),
        context,
      )?.text,
    ).toBe("resumed the project and moved the delivery date to 9 Nov");
  });
});
