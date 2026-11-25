import { describe, expect, it } from "vitest";

import {
  changedSinceClose,
  correctMonthSchema,
  type SnapshotData,
  snapshotDataSchema,
  toMonthCloseRead,
} from "../domain/month-close";

const CL = "00000000-0000-4000-8000-0000000000c1";
const P1 = "10000000-0000-4000-8000-000000000001";
const P2 = "20000000-0000-4000-8000-000000000002";
const CY1 = "a0000000-0000-4000-8000-000000000001";
const CY2 = "b0000000-0000-4000-8000-000000000002";
const I1 = "c0000000-0000-4000-8000-000000000001";
const I2 = "d0000000-0000-4000-8000-000000000002";
const AD = "e0000000-0000-4000-8000-000000000001";
const OWNER = "f0000000-0000-4000-8000-000000000001";

type Cycle = SnapshotData["revenue"]["cycles"][number];
type Item = Cycle["items"][number];
type Project = SnapshotData["revenue"]["projects"][number];
type Advance = SnapshotData["revenue"]["advances"][number];

const item = (id: string, title: string, achieved: boolean): Item => ({
  item_id: id,
  title,
  position: "a0",
  kind: "plan",
  method: "split",
  value: 3000,
  in_potential: true,
  achieved,
  closed_not_achieved: false,
  leaf_item_id: id,
  leaf_state: achieved ? "approved" : "open",
  approved_at: achieved ? "2026-10-10T06:30:00+00:00" : null,
  approved_by: achieved ? OWNER : null,
});

const cycle = (id: string, achieved: number, items: Item[], names = "Monthly"): Cycle => ({
  cycle_id: id,
  label: "October 2026",
  period_start: "2026-10-01",
  period_end: "2026-10-31",
  client_id: CL,
  client_name: `${names} client`,
  project_id: P1,
  project_name: names,
  category: "retainer",
  amount: 6000,
  potential: 6000,
  achieved_calculated: achieved,
  achieved,
  override: null,
  closed_not_achieved: 0,
  remaining: 6000 - achieved,
  added_value: 0,
  added_count: 0,
  not_priced_count: 0,
  plan_count: 2,
  done_count: items.filter((i) => i.achieved).length,
  held: false,
  billing_status: "not_billed",
  billed_on: null,
  billing_note: null,
  items,
});

const project = (achieved: number): Project => ({
  project_id: P2,
  cycle_id: null,
  client_id: CL,
  client_name: "Film client",
  project_name: "Film",
  category: "project",
  state: achieved > 0 ? "completed" : "in_progress",
  delivery_date: "2026-10-20",
  amount: 20000,
  potential: 20000,
  achieved_calculated: achieved,
  achieved,
  override: null,
  closed_not_achieved: 0,
  remaining: 20000 - achieved,
  was_due: false,
  ready_to_complete: false,
  held: false,
  advances_kept: 0,
  advances_returned: 0,
  billing_status: "not_billed",
  billed_on: null,
  billing_note: null,
});

const advance = (event: "received" | "returned", amount: number): Advance => ({
  advance_id: AD,
  event,
  on_date: "2026-10-03",
  amount,
  note: null,
  returned: event === "returned",
  client_id: CL,
  client_name: "Film client",
  project_id: P2,
  project_name: "Film",
});

function doc(cycles: Cycle[], projects: Project[] = [], advances: Advance[] = []): SnapshotData {
  const lines = [...cycles, ...projects];
  const sum = (key: "potential" | "achieved" | "remaining" | "closed_not_achieved") =>
    lines.reduce((total, line) => total + line[key], 0);
  const advanceSum = (event: "received" | "returned") =>
    advances.filter((a) => a.event === event).reduce((total, a) => total + a.amount, 0);
  return {
    schema: 1,
    month: "2026-10-01",
    revenue: {
      cycles,
      projects,
      advances,
      totals: {
        potential: sum("potential"),
        achieved: sum("achieved"),
        remaining: sum("remaining"),
        closed_not_achieved: sum("closed_not_achieved"),
        advances_received: advanceSum("received"),
        advances_returned: advanceSum("returned"),
        by_client: [],
        by_category: [],
      },
    },
    expenses: [],
    month_summary: [],
  };
}

const closed = doc([cycle(CY1, 3000, [item(I1, "A", true), item(I2, "B", false)])]);

describe("changedSinceClose", () => {
  it("finds nothing when the live month is the stored one", () => {
    expect(changedSinceClose(closed, closed)).toEqual({ lines: [], totals: [] });
  });

  it("ignores names: a renamed client, project or deliverable is not a change", () => {
    const renamed = doc([
      cycle(CY1, 3000, [item(I1, "A renamed", true), item(I2, "B", false)], "Renamed"),
    ]);
    expect(changedSinceClose(closed, renamed)).toEqual({ lines: [], totals: [] });
  });

  it("shows a reopened deliverable and its cycle, before and after, in today's names", () => {
    const live = doc([
      cycle(CY1, 0, [item(I1, "A renamed", false), item(I2, "B", false)], "Renamed"),
    ]);
    expect(changedSinceClose(closed, live)).toEqual({
      lines: [
        {
          kind: "changed",
          line: "cycle",
          id: CY1,
          cycleId: null,
          what: "Renamed · Renamed client · October 2026",
          before: {
            amount: 6000,
            potential: 6000,
            achieved: 3000,
            remaining: 3000,
            closed_not_achieved: 0,
          },
          after: {
            amount: 6000,
            potential: 6000,
            achieved: 0,
            remaining: 6000,
            closed_not_achieved: 0,
          },
          cause: null,
        },
        {
          kind: "changed",
          line: "item",
          id: I1,
          cycleId: CY1,
          what: "A renamed · Renamed",
          before: { value: 3000, achieved: true, in_potential: true, closed_not_achieved: false },
          after: { value: 3000, achieved: false, in_potential: true, closed_not_achieved: false },
          cause: null,
        },
      ],
      totals: [
        { key: "achieved", before: 3000, after: 0 },
        { key: "remaining", before: 3000, after: 6000 },
      ],
    });
  });

  it("lists an added cycle once, without its deliverables, and a removed line with its stored figures", () => {
    const stored = doc([cycle(CY1, 3000, [item(I1, "A", true)])], [project(20000)]);
    const live = doc([
      cycle(CY1, 3000, [item(I1, "A", true)]),
      cycle(CY2, 0, [item(I2, "B", false)]),
    ]);
    const { lines } = changedSinceClose(stored, live);
    expect(lines.map((l) => [l.kind, l.line, l.id])).toEqual([
      ["added", "cycle", CY2],
      ["removed", "project", P2],
    ]);
    expect(lines[1]?.before).toMatchObject({ achieved: 20000 });
    expect(lines[1]?.after).toBeNull();
    expect(lines[1]?.what).toBe("Film · Film client");
  });

  it("keeps an advance's two events apart, received before returned", () => {
    const stored = doc([], [], [advance("received", 5000)]);
    const live = doc([], [], [advance("received", 4000), advance("returned", 1000)]);
    const result = changedSinceClose(stored, live);
    expect(result.lines.map((l) => [l.kind, l.line, l.before, l.after, l.what])).toEqual([
      [
        "changed",
        "advance_received",
        { amount: 5000 },
        { amount: 4000 },
        "Advance received · Film",
      ],
      ["added", "advance_returned", null, { amount: 1000 }, "Advance returned · Film"],
    ]);
    expect(result.totals).toEqual([
      { key: "advances_received", before: 5000, after: 4000 },
      { key: "advances_returned", before: 0, after: 1000 },
    ]);
  });

  it("orders lines by kind, then by id (as the database's bytewise order)", () => {
    const stored = doc([]);
    const live = doc([cycle(CY2, 0, []), cycle(CY1, 0, [])], [project(0)]);
    expect(changedSinceClose(stored, live).lines.map((l) => l.id)).toEqual([CY1, CY2, P2]);
  });

  it("compares a numeric that arrives as text by its value", () => {
    const asText = snapshotDataSchema.parse(
      JSON.parse(JSON.stringify(closed).replaceAll(":3000,", ':"3000.00",')),
    );
    expect(changedSinceClose(closed, asText)).toEqual({ lines: [], totals: [] });
  });
});

describe("toMonthCloseRead", () => {
  const notClosed = {
    month: "2026-10-01",
    month_name: "October 2026",
    closed: false,
    can_close: true,
    cannot_close: null,
    waiting: {
      attendance: 1,
      leave: 0,
      leaving_early: 0,
      extra_work: 0,
      expense_claims: 2,
      open_work: 0,
      carry_decisions: 1,
      no_amount: 0,
      ready_to_complete: 0,
      total: 4,
      claims_until: "2026-11-05",
      claims_open: false,
    },
    latest: null,
    versions: [],
    changed_since_close: null,
  };

  it("reads a month not closed: can it be closed, and the waiting list", () => {
    const read = toMonthCloseRead(notClosed);
    expect(read.canClose).toBe(true);
    expect(read.latest).toBeNull();
    expect(read.waiting).toMatchObject({
      expenseClaims: 2,
      carryDecisions: 1,
      total: 4,
      claimsOpen: false,
    });
  });

  it("reads a closed month: the latest version, the versions and what changed", () => {
    const read = toMonthCloseRead({
      ...notClosed,
      closed: true,
      can_close: false,
      cannot_close: { reason: "closed", message: "October 2026 is already closed." },
      waiting: null,
      latest: {
        id: CY1,
        version: 2,
        closed_at: "2026-11-03T05:00:00+00:00",
        closed_by_id: OWNER,
        closed_by_name: "Owner",
        data: closed,
      },
      versions: [
        {
          id: CY2,
          version: 1,
          closed_at: "2026-11-02T05:00:00+00:00",
          closed_by_id: OWNER,
          closed_by_name: "Owner",
          corrects_id: null,
          note: null,
        },
        {
          id: CY1,
          version: 2,
          closed_at: "2026-11-03T05:00:00+00:00",
          closed_by_id: OWNER,
          closed_by_name: "Owner",
          corrects_id: CY2,
          note: "A reopened after the close",
        },
      ],
      changed_since_close: {
        lines: [
          {
            kind: "changed",
            line: "item",
            id: I1,
            cycle_id: CY1,
            what: "A · Monthly",
            before: {
              value: "3000.00",
              achieved: true,
              in_potential: true,
              closed_not_achieved: false,
            },
            after: { value: 3000, achieved: false, in_potential: true, closed_not_achieved: false },
            cause: {
              action: "reopened",
              by_id: OWNER,
              by_name: "Ravi",
              at: "2026-11-04T05:00:00+00:00",
            },
          },
        ],
        totals: [{ key: "achieved", before: 3000, after: 0 }],
      },
    });
    expect(read.latest?.version).toBe(2);
    expect(read.versions.map((v) => [v.version, v.correctsId, v.note])).toEqual([
      [1, null, null],
      [2, CY2, "A reopened after the close"],
    ]);
    expect(read.changedSinceClose?.lines[0]).toMatchObject({
      cycleId: CY1,
      before: { value: 3000 },
      cause: { action: "reopened", byName: "Ravi" },
    });
  });

  it("refuses a snapshot in a later shape, without repeating any value", () => {
    expect(() =>
      toMonthCloseRead({
        ...notClosed,
        closed: true,
        latest: {
          id: CY1,
          version: 1,
          closed_at: "x",
          closed_by_id: OWNER,
          closed_by_name: null,
          data: { ...closed, schema: 2 },
        },
      }),
    ).toThrow("The month close read is not in a shape MaxOff knows.");
  });
});

describe("correctMonthSchema", () => {
  it("trims the note and asks for 10 to 500 characters", () => {
    expect(
      correctMonthSchema.parse({ month: "2026-10-01", note: "  Reel 3 reopened  " }).note,
    ).toBe("Reel 3 reopened");
    for (const note of ["   123456789  ", "x".repeat(501)]) {
      const result = correctMonthSchema.safeParse({ month: "2026-10-01", note });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("Write a note of 10 to 500 characters.");
    }
  });
});
