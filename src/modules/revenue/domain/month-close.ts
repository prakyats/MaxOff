import { z } from "zod";

/**
 * The month close (v3.5 "Month close"; WORKFLOWS §7, DATA-MODEL §9 and §9a, ADR-0007 amendment
 * 2026-11-25): the frozen snapshot's document (`schema: 1`), the one read `month_close_read`
 * answers, and `changedSinceClose`, the pure twin of the database's "Changed since close"
 * (`app.month_revenue_changes`). Pure, and **Owner only**: a snapshot is money (invariant 2), so
 * nothing here is ever in an Admin's or a Crew member's payload.
 *
 * The snapshot document keeps the database's own field names (snake_case): it is a frozen record,
 * read as it was stored. The read around it is in the app's names.
 */

/** The correction note's bounds, after trimming (the table's check, WORKFLOWS §7.1). */
export const CORRECTION_NOTE_MIN_LENGTH = 10;
export const CORRECTION_NOTE_MAX_LENGTH = 500;

const correctionNoteMessage = `Write a note of ${CORRECTION_NOTE_MIN_LENGTH} to ${CORRECTION_NOTE_MAX_LENGTH} characters.`;

/** A month as any of its dates (the functions work on its 1st, IST). */
const monthDate = z.iso.date({ error: "Pick a month." });

export const closeMonthSchema = z.object({ month: monthDate });
export type CloseMonthInput = z.input<typeof closeMonthSchema>;

export const correctMonthSchema = z.object({
  month: monthDate,
  note: z
    .string({ error: correctionNoteMessage })
    .trim()
    .min(CORRECTION_NOTE_MIN_LENGTH, correctionNoteMessage)
    .max(CORRECTION_NOTE_MAX_LENGTH, correctionNoteMessage),
});
export type CorrectMonthInput = z.input<typeof correctMonthSchema>;

// --- The snapshot document (DATA-MODEL §9a "As built (U2)") ------------------------------------

/** A `numeric` arrives as a JSON number (or a string from an older driver). */
const amount = z
  .union([z.number(), z.string()])
  .transform(Number)
  .refine(Number.isFinite, "The month close read holds an amount that is not one.");
const amountOrNull = amount.nullable();
const uuid = z.string();
const day = z.string();

const override = z
  .object({
    id: uuid,
    calculated_value: amountOrNull,
    adjusted_value: amount,
    note: z.string().nullable(),
    by_id: uuid.nullable(),
    at: z.string(),
  })
  .nullable();

const snapshotItem = z.object({
  item_id: uuid,
  title: z.string(),
  position: z.string().nullable(),
  kind: z.string(),
  method: z.string(),
  value: amountOrNull,
  in_potential: z.boolean(),
  achieved: z.boolean(),
  closed_not_achieved: z.boolean(),
  leaf_item_id: uuid.nullable(),
  leaf_state: z.string().nullable(),
  approved_at: z.string().nullable(),
  approved_by: uuid.nullable(),
});

const snapshotCycle = z.object({
  cycle_id: uuid,
  label: z.string().nullable(),
  period_start: day,
  period_end: day,
  client_id: uuid,
  client_name: z.string(),
  project_id: uuid,
  project_name: z.string(),
  category: z.string(),
  amount: amountOrNull,
  potential: amount,
  achieved_calculated: amount,
  achieved: amount,
  override,
  closed_not_achieved: amount,
  remaining: amount,
  added_value: amount,
  added_count: z.number(),
  not_priced_count: z.number(),
  plan_count: z.number(),
  done_count: z.number(),
  held: z.boolean(),
  billing_status: z.string(),
  billed_on: day.nullable(),
  billing_note: z.string().nullable(),
  items: z.array(snapshotItem),
});

const snapshotProject = z.object({
  project_id: uuid,
  cycle_id: uuid.nullable(),
  client_id: uuid,
  client_name: z.string(),
  project_name: z.string(),
  category: z.string(),
  state: z.string(),
  delivery_date: day.nullable(),
  amount: amountOrNull,
  potential: amount,
  achieved_calculated: amount,
  achieved: amount,
  override,
  closed_not_achieved: amount,
  remaining: amount,
  was_due: z.boolean(),
  ready_to_complete: z.boolean(),
  held: z.boolean(),
  advances_kept: amount,
  advances_returned: amount,
  billing_status: z.string(),
  billed_on: day.nullable(),
  billing_note: z.string().nullable(),
});

const snapshotAdvance = z.object({
  advance_id: uuid,
  event: z.enum(["received", "returned"]),
  on_date: day,
  amount,
  note: z.string().nullable(),
  returned: z.boolean(),
  client_id: uuid,
  client_name: z.string(),
  project_id: uuid,
  project_name: z.string(),
});

const figures = {
  potential: amount,
  achieved: amount,
  remaining: amount,
  closed_not_achieved: amount,
};

export const TOTAL_KEYS = [
  "potential",
  "achieved",
  "remaining",
  "closed_not_achieved",
  "advances_received",
  "advances_returned",
] as const;
export type TotalKey = (typeof TOTAL_KEYS)[number];

const snapshotTotals = z.object({
  ...figures,
  advances_received: amount,
  advances_returned: amount,
  by_client: z.array(z.object({ client_id: uuid, client_name: z.string(), ...figures })),
  by_category: z.array(z.object({ category: z.string(), ...figures })),
});

/**
 * `month_snapshots_read`'s answer (the Revenue page's light read of an ended month): the versions'
 * numbers and dates, the latest version's schema and revenue section (read by
 * `closedRevenueMonth`, which refuses a schema it does not know), and the organization's first
 * priced month (its 1st), null when nothing is priced yet. Never a value in a message.
 */
export const monthSnapshotsSchema = z.object({
  versions: z.array(z.object({ version: z.number().int().positive(), closed_at: z.string() })),
  latest: z.object({ schema: z.unknown(), revenue: z.unknown() }).nullable(),
  first_priced_month: z.iso.date().nullable(),
});

/** The month's frozen report, `schema: 1`. A later shape is `schema: 2` and is refused here. */
export const snapshotDataSchema = z.object({
  schema: z.literal(1, { error: "This snapshot is in a shape MaxOff does not read yet." }),
  month: day,
  revenue: z.object({
    cycles: z.array(snapshotCycle),
    projects: z.array(snapshotProject),
    advances: z.array(snapshotAdvance),
    totals: snapshotTotals,
  }),
  expenses: z.array(
    z.object({
      member_id: uuid,
      full_name: z.string(),
      approved: amount,
      approved_count: z.number(),
      paid: amount,
      paid_count: z.number(),
    }),
  ),
  /** `month_summary()`'s own columns, one object per person (`id` = the member). */
  month_summary: z.array(z.looseObject({ id: uuid, full_name: z.string() })),
});
export type SnapshotData = z.output<typeof snapshotDataSchema>;
type SnapshotCycle = SnapshotData["revenue"]["cycles"][number];
type SnapshotItem = SnapshotCycle["items"][number];
type SnapshotProject = SnapshotData["revenue"]["projects"][number];
type SnapshotAdvance = SnapshotData["revenue"]["advances"][number];

// --- "Changed since close" ---------------------------------------------------------------------

export type LineFigures = {
  amount: number | null;
  potential: number;
  achieved: number;
  remaining: number;
  closed_not_achieved: number;
};
export type ItemFigures = {
  value: number | null;
  achieved: boolean;
  in_potential: boolean;
  closed_not_achieved: boolean;
};
export type AdvanceFigures = { amount: number };

export type ChangeKind = "added" | "removed" | "changed";
export type ChangeLine = "cycle" | "item" | "project" | "advance_received" | "advance_returned";

/** Who changed a deliverable since the close, from its history (the database's read only). */
export type ChangeCause = {
  action: "done" | "reopened" | "sent_back" | "cancelled" | "closed";
  byId: string | null;
  byName: string | null;
  at: string;
};

type ChangeBase<L extends ChangeLine, F> = {
  kind: ChangeKind;
  line: L;
  id: string;
  /** A deliverable's cycle; null for every other line. */
  cycleId: string | null;
  /** The line in plain words, in today's names (the stored ones for a line no longer there). */
  what: string;
  before: F | null;
  after: F | null;
  cause: ChangeCause | null;
};
export type LineChange =
  | ChangeBase<"cycle" | "project", LineFigures>
  | ChangeBase<"item", ItemFigures>
  | ChangeBase<"advance_received" | "advance_returned", AdvanceFigures>;
export type TotalChange = { key: TotalKey; before: number | null; after: number | null };
export type ChangedSinceClose = { lines: LineChange[]; totals: TotalChange[] };

const LINE_ORDER: Record<ChangeLine, number> = {
  cycle: 1,
  item: 2,
  project: 3,
  advance_received: 4,
  advance_returned: 5,
};

const lineFigures = (line: SnapshotCycle | SnapshotProject): LineFigures => ({
  amount: line.amount,
  potential: line.potential,
  achieved: line.achieved,
  remaining: line.remaining,
  closed_not_achieved: line.closed_not_achieved,
});
const itemFigures = (item: SnapshotItem): ItemFigures => ({
  value: item.value,
  achieved: item.achieved,
  in_potential: item.in_potential,
  closed_not_achieved: item.closed_not_achieved,
});
const advanceFigures = (advance: SnapshotAdvance): AdvanceFigures => ({ amount: advance.amount });

function sameFigures<F extends object>(a: F, b: F): boolean {
  return (Object.keys(a) as (keyof F)[]).every((key) => a[key] === b[key]);
}

const kindOf = (before: unknown, after: unknown): ChangeKind =>
  after === undefined ? "removed" : before === undefined ? "added" : "changed";

function byKey<T>(rows: readonly T[], key: (row: T) => string): Map<string, T> {
  return new Map(rows.map((row) => [key(row), row]));
}

/** Every key of two maps, in no particular order (the result is sorted at the end). */
function keysOf<T>(a: Map<string, T>, b: Map<string, T>): string[] {
  return [...new Set([...a.keys(), ...b.keys()])];
}

/**
 * "Changed since close" (WORKFLOWS §7.1, v3.5 Q6): the revenue lines and totals of the latest
 * stored version against a live rebuild, **by stable id, figures only** — a renamed client,
 * project or deliverable is not a change. The same rules as `app.month_revenue_changes`:
 * cycles by `cycle_id`, their deliverables by `item_id` (only inside a cycle in both documents),
 * one-time lines by `project_id`, advance events by `advance_id` and event, then the six totals;
 * ordered by line (cycle, item, project, advance received, advance returned), then id. `cause` is
 * always null here: who made a change is read from the history, in the database only.
 */
export function changedSinceClose(stored: SnapshotData, live: SnapshotData): ChangedSinceClose {
  const lines: LineChange[] = [];

  const storedCycles = byKey(stored.revenue.cycles, (cycle) => cycle.cycle_id);
  const liveCycles = byKey(live.revenue.cycles, (cycle) => cycle.cycle_id);
  for (const id of keysOf(storedCycles, liveCycles)) {
    const before = storedCycles.get(id);
    const after = liveCycles.get(id);
    const shown = after ?? before;
    if (!shown) continue;
    const change: LineChange = {
      kind: kindOf(before, after),
      line: "cycle",
      id,
      cycleId: null,
      what: `${shown.project_name} · ${shown.client_name} · ${shown.label ?? ""}`,
      before: before ? lineFigures(before) : null,
      after: after ? lineFigures(after) : null,
      cause: null,
    };
    if (!change.before || !change.after || !sameFigures(change.before, change.after)) {
      lines.push(change);
    }
    if (!before || !after) continue;
    const storedItems = byKey(before.items, (item) => item.item_id);
    const liveItems = byKey(after.items, (item) => item.item_id);
    for (const itemId of keysOf(storedItems, liveItems)) {
      const itemBefore = storedItems.get(itemId);
      const itemAfter = liveItems.get(itemId);
      const itemShown = itemAfter ?? itemBefore;
      if (!itemShown) continue;
      const itemChange: LineChange = {
        kind: kindOf(itemBefore, itemAfter),
        line: "item",
        id: itemId,
        cycleId: id,
        what: `${itemShown.title} · ${shown.project_name}`,
        before: itemBefore ? itemFigures(itemBefore) : null,
        after: itemAfter ? itemFigures(itemAfter) : null,
        cause: null,
      };
      if (
        !itemChange.before ||
        !itemChange.after ||
        !sameFigures(itemChange.before, itemChange.after)
      ) {
        lines.push(itemChange);
      }
    }
  }

  const storedProjects = byKey(stored.revenue.projects, (project) => project.project_id);
  const liveProjects = byKey(live.revenue.projects, (project) => project.project_id);
  for (const id of keysOf(storedProjects, liveProjects)) {
    const before = storedProjects.get(id);
    const after = liveProjects.get(id);
    const shown = after ?? before;
    if (!shown) continue;
    const change: LineChange = {
      kind: kindOf(before, after),
      line: "project",
      id,
      cycleId: null,
      what: `${shown.project_name} · ${shown.client_name}`,
      before: before ? lineFigures(before) : null,
      after: after ? lineFigures(after) : null,
      cause: null,
    };
    if (!change.before || !change.after || !sameFigures(change.before, change.after)) {
      lines.push(change);
    }
  }

  const advanceKey = (advance: SnapshotAdvance): string => `${advance.advance_id}:${advance.event}`;
  const storedAdvances = byKey(stored.revenue.advances, advanceKey);
  const liveAdvances = byKey(live.revenue.advances, advanceKey);
  for (const key of keysOf(storedAdvances, liveAdvances)) {
    const before = storedAdvances.get(key);
    const after = liveAdvances.get(key);
    const shown = after ?? before;
    if (!shown) continue;
    const change: LineChange = {
      kind: kindOf(before, after),
      line: shown.event === "received" ? "advance_received" : "advance_returned",
      id: shown.advance_id,
      cycleId: null,
      what: `Advance ${shown.event} · ${shown.project_name}`,
      before: before ? advanceFigures(before) : null,
      after: after ? advanceFigures(after) : null,
      cause: null,
    };
    if (!change.before || !change.after || !sameFigures(change.before, change.after)) {
      lines.push(change);
    }
  }

  lines.sort((a, b) =>
    LINE_ORDER[a.line] !== LINE_ORDER[b.line]
      ? LINE_ORDER[a.line] - LINE_ORDER[b.line]
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0,
  );

  const totals = TOTAL_KEYS.flatMap((key): TotalChange[] => {
    const before = stored.revenue.totals[key];
    const after = live.revenue.totals[key];
    return before === after ? [] : [{ key, before, after }];
  });

  return { lines, totals };
}

// --- The read (`month_close_read`, WORKFLOWS §7.4 "As built (U3)") ------------------------------

const lineFiguresSchema = z.object({
  amount: amountOrNull,
  potential: amount,
  achieved: amount,
  remaining: amount,
  closed_not_achieved: amount,
});
const itemFiguresSchema = z.object({
  value: amountOrNull,
  achieved: z.boolean(),
  in_potential: z.boolean(),
  closed_not_achieved: z.boolean(),
});
const advanceFiguresSchema = z.object({ amount });

const causeSchema = z
  .object({
    action: z.enum(["done", "reopened", "sent_back", "cancelled", "closed"]),
    by_id: uuid.nullable(),
    by_name: z.string().nullable(),
    at: z.string(),
  })
  .nullable()
  .transform((cause): ChangeCause | null =>
    cause ? { action: cause.action, byId: cause.by_id, byName: cause.by_name, at: cause.at } : null,
  );

const changeCommon = {
  kind: z.enum(["added", "removed", "changed"]),
  id: uuid,
  cycle_id: uuid.nullable(),
  what: z.string(),
  cause: causeSchema,
};
const lineChangeSchema = z
  .discriminatedUnion("line", [
    z.object({
      ...changeCommon,
      line: z.enum(["cycle", "project"]),
      before: lineFiguresSchema.nullable(),
      after: lineFiguresSchema.nullable(),
    }),
    z.object({
      ...changeCommon,
      line: z.literal("item"),
      before: itemFiguresSchema.nullable(),
      after: itemFiguresSchema.nullable(),
    }),
    z.object({
      ...changeCommon,
      line: z.enum(["advance_received", "advance_returned"]),
      before: advanceFiguresSchema.nullable(),
      after: advanceFiguresSchema.nullable(),
    }),
  ])
  .transform(({ cycle_id, ...change }): LineChange => ({ ...change, cycleId: cycle_id }));

const changedSinceCloseSchema = z.object({
  lines: z.array(lineChangeSchema),
  totals: z.array(z.object({ key: z.enum(TOTAL_KEYS), before: amountOrNull, after: amountOrNull })),
});

const waitingSchema = z
  .object({
    attendance: z.number(),
    leave: z.number(),
    leaving_early: z.number(),
    extra_work: z.number(),
    expense_claims: z.number(),
    open_work: z.number(),
    carry_decisions: z.number(),
    no_amount: z.number(),
    ready_to_complete: z.number(),
    total: z.number(),
    claims_until: day,
    claims_open: z.boolean(),
  })
  .transform((w) => ({
    attendance: w.attendance,
    leave: w.leave,
    leavingEarly: w.leaving_early,
    extraWork: w.extra_work,
    expenseClaims: w.expense_claims,
    openWork: w.open_work,
    carryDecisions: w.carry_decisions,
    noAmount: w.no_amount,
    readyToComplete: w.ready_to_complete,
    total: w.total,
    claimsUntil: w.claims_until,
    claimsOpen: w.claims_open,
  }));
export type WaitingList = z.output<typeof waitingSchema>;

const versionSchema = z
  .object({
    id: uuid,
    version: z.number().int().min(1),
    closed_at: z.string(),
    closed_by_id: uuid,
    closed_by_name: z.string().nullable(),
    corrects_id: uuid.nullable(),
    note: z.string().nullable(),
  })
  .transform((v) => ({
    id: v.id,
    version: v.version,
    closedAt: v.closed_at,
    closedById: v.closed_by_id,
    closedByName: v.closed_by_name,
    correctsId: v.corrects_id,
    note: v.note,
  }));
export type SnapshotVersion = z.output<typeof versionSchema>;

export const CANNOT_CLOSE_REASONS = ["not_ended", "nothing_to_close", "closed"] as const;
export type CannotCloseReason = (typeof CANNOT_CLOSE_REASONS)[number];

const monthCloseReadSchema = z
  .object({
    month: day,
    month_name: z.string(),
    closed: z.boolean(),
    can_close: z.boolean(),
    cannot_close: z
      .object({ reason: z.enum(CANNOT_CLOSE_REASONS), message: z.string() })
      .nullable(),
    waiting: waitingSchema.nullable(),
    latest: z
      .object({
        id: uuid,
        version: z.number().int().min(1),
        closed_at: z.string(),
        closed_by_id: uuid,
        closed_by_name: z.string().nullable(),
        data: snapshotDataSchema,
      })
      .nullable(),
    versions: z.array(versionSchema),
    changed_since_close: changedSinceCloseSchema.nullable(),
  })
  .transform((read) => ({
    month: read.month,
    monthName: read.month_name,
    closed: read.closed,
    canClose: read.can_close,
    cannotClose: read.cannot_close,
    waiting: read.waiting,
    latest: read.latest
      ? {
          id: read.latest.id,
          version: read.latest.version,
          closedAt: read.latest.closed_at,
          closedById: read.latest.closed_by_id,
          closedByName: read.latest.closed_by_name,
          data: read.latest.data,
        }
      : null,
    versions: read.versions,
    changedSinceClose: read.changed_since_close,
  }));
export type MonthCloseRead = z.output<typeof monthCloseReadSchema>;

/**
 * `month_close_read`'s JSON as the app's shape. A month not closed has `waiting` (null before
 * the first priced month) and no snapshot; a closed one has `latest`, `versions` and
 * `changedSinceClose`, and no waiting list. The error never repeats a value: a report carries no
 * money (ARCHITECTURE §18.2).
 */
export function toMonthCloseRead(value: unknown): MonthCloseRead {
  const parsed = monthCloseReadSchema.safeParse(value);
  if (!parsed.success) throw new Error("The month close read is not in a shape MaxOff knows.");
  return parsed.data;
}
