import { formatRupees } from "@/core/lib/rupees";
import { formatIST, istDayStart } from "@/core/time";

/**
 * A project's Billing section (9.2, v2.1 "Money in"; DATA-MODEL §7, WORKFLOWS §6): what the one
 * read (`project_billing_read`) answers, in the app's own names, and the words the section and
 * its sheets say. Owner only: nothing here is ever in an Admin's or a Crew member's payload
 * (invariant 2). Zod-free, so the client sheets use it without bundling the schemas.
 */

export const BILLING_CATEGORIES = ["retainer", "project", "additional_work"] as const;
export type BillingCategory = (typeof BILLING_CATEGORIES)[number];

export const BILLING_CATEGORY_LABELS: Record<BillingCategory, string> = {
  retainer: "Retainer",
  project: "Project",
  additional_work: "Additional Work",
};

export function isBillingCategory(value: unknown): value is BillingCategory {
  return typeof value === "string" && (BILLING_CATEGORIES as readonly string[]).includes(value);
}

export type BillingRecurrence = "one_time" | "weekly" | "monthly";

/** What the Owner has set on the project itself. */
export type BillingBasics = {
  category: BillingCategory;
  /** No category chosen yet: it follows the repeat (a retainer, or a one-time project). */
  categoryIsDefault: boolean;
  /** A retainer's amount for each new cycle; null = "No amount set". */
  cycleAmount: number | null;
  /** A one-time project's lump sum; null = "No amount set". */
  fixedAmount: number | null;
  /** The 1st of the IST month the first amount was entered in; null until then. */
  pricedFrom: string | null;
};

/**
 * Billed / Not billed (v2.5; decision 7): a retainer cycle's, or a one-time project's through its
 * single cycle. `billedOn` is set exactly when it is billed.
 */
export type BillingMark = {
  billed: boolean;
  billedOn: string | null;
  note: string | null;
};

/**
 * The Owner's adjustment of Achieved (v2.5; decision 6): what he set, beside what the system had
 * calculated when he set it, with his note. Null = Achieved is as calculated.
 */
export type Adjustment = {
  adjustedValue: number;
  calculatedValue: number;
  note: string;
  at: string;
};

/** The figures of the retainer cycle in view. */
export type CycleFigures = {
  cycleId: string;
  label: string | null;
  /** The IST month the cycle counts in (its first day), for the closed-month line (v3.5 U5). */
  month: string | null;
  /** This cycle's own amount; null = "No amount set" (a cycle from before the first amount). */
  amount: number | null;
  potential: number;
  /** The headline Achieved: the Owner's adjusted figure when there is one. */
  achieved: number;
  /** What approved work adds up to, whatever the Owner adjusted ("System calculated"). */
  achievedCalculated: number;
  remaining: number;
  mark: BillingMark;
  adjustment: Adjustment | null;
};

/**
 * How a planned deliverable is valued (v2.5; WORKFLOWS §6): its own value off the top of the
 * cycle's amount (`explicit`), an even share of what is left (`split`), nothing while the cycle
 * has no amount (`no_amount`), or left out of Potential ("Not needed", cancelled before the cycle
 * started: `excluded`).
 */
export type PlannedMethod = "explicit" | "split" | "no_amount" | "excluded";

/** One of the cycle's planned deliverables with its value (v2.5). */
export type PlannedDeliverable = {
  itemId: string;
  title: string;
  method: PlannedMethod;
  value: number;
};

/** A deliverable added to the cycle after its item list: priced on top of the amount (R4). */
export type AddedDeliverable = {
  itemId: string;
  title: string;
  /** Null until the Owner prices it ("Not priced"); 0 = "Not billable". */
  price: number | null;
};

/** An advance received on a one-time project; a returned one keeps its row. */
export type Advance = {
  id: string;
  amount: number;
  receivedOn: string;
  note: string | null;
  returnedOn: string | null;
  returnNote: string | null;
};

export type RetainerBilling = {
  kind: "retainer";
  projectId: string;
  recurrence: "weekly" | "monthly";
  billing: BillingBasics;
  cycle: CycleFigures | null;
  /** The cycle's planned deliverables (v2.5), in the list's order; empty with no cycle in view. */
  planned: PlannedDeliverable[];
  added: AddedDeliverable[];
};

/** A one-time project's line (v2.5): its Billed mark, through its single cycle, and its Achieved. */
export type OneTimeLine = {
  /** The project's one cycle, through which it is marked Billed; null if it has none. */
  cycleId: string | null;
  state: "open" | "in_progress" | "completed" | "cancelled";
  achieved: number;
  achievedCalculated: number;
  mark: BillingMark;
  adjustment: Adjustment | null;
};

export type OneTimeBilling = {
  kind: "one_time";
  projectId: string;
  recurrence: "one_time";
  billing: BillingBasics;
  /** The IST month the project counts in (its first day; null before it has a line), v3.5 U5. */
  month: string | null;
  /** The delivery date, when the project is working and past it ("Was due 15 Nov"). */
  wasDue: string | null;
  readyToComplete: boolean;
  /** The advances received and not returned, summed. */
  advancesKept: number;
  advances: Advance[];
  line: OneTimeLine | null;
};

export type ProjectBilling = RetainerBilling | OneTimeBilling;

type Json = Record<string, unknown>;

function record(value: unknown, what: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`The billing read's ${what} is missing.`);
  }
  return value as Json;
}

function rows(value: unknown): Json[] {
  return Array.isArray(value) ? value.map((row) => record(row, "row")) : [];
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string") throw new Error(`The billing read's ${what} is missing.`);
  return value;
}

const textOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** A `numeric` arrives as a JSON number (or a string from an older driver); null stays null. */
function amountOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount))
    throw new Error("The billing read holds an amount that is not one.");
  return amount;
}

const amount = (value: unknown): number => amountOrNull(value) ?? 0;

function toMark(row: Json): BillingMark {
  const billed = row.billing_status === "billed";
  return {
    billed,
    billedOn: billed ? textOrNull(row.billed_on) : null,
    note: billed ? textOrNull(row.billing_note) : null,
  };
}

function toAdjustment(value: unknown): Adjustment | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Json;
  return {
    adjustedValue: amount(row.adjusted_value),
    calculatedValue: amount(row.calculated_value),
    note: typeof row.note === "string" ? row.note : "",
    at: typeof row.at === "string" ? row.at : "",
  };
}

const PLANNED_METHODS: readonly PlannedMethod[] = ["explicit", "split", "no_amount", "excluded"];

function plannedMethod(value: unknown): PlannedMethod {
  const method = PLANNED_METHODS.find((known) => known === value);
  if (!method) throw new Error("The billing read holds a value method MaxOff does not know.");
  return method;
}

const LINE_STATES: readonly OneTimeLine["state"][] = [
  "open",
  "in_progress",
  "completed",
  "cancelled",
];

function lineState(value: unknown): OneTimeLine["state"] {
  const state = LINE_STATES.find((known) => known === value);
  if (!state) throw new Error("The billing read holds a project state MaxOff does not know.");
  return state;
}

function toBasics(value: unknown, recurrence: BillingRecurrence): BillingBasics {
  const row = record(value, "billing");
  return {
    category: isBillingCategory(row.category)
      ? row.category
      : recurrence === "one_time"
        ? "project"
        : "retainer",
    categoryIsDefault: row.category_is_default !== false,
    cycleAmount: amountOrNull(row.cycle_amount),
    fixedAmount: amountOrNull(row.fixed_amount),
    pricedFrom: textOrNull(row.priced_from),
  };
}

/** The read's JSON (snake_case, DATA-MODEL §7) as the section's own shape. */
export function toProjectBilling(value: unknown): ProjectBilling {
  const read = record(value, "answer");
  const projectId = text(read.project_id, "project");
  const recurrence = text(read.recurrence, "repeat");
  if (recurrence === "one_time") {
    const line = read.line ? record(read.line, "line") : null;
    return {
      kind: "one_time",
      projectId,
      recurrence,
      billing: toBasics(read.billing, recurrence),
      month: textOrNull(line?.month),
      wasDue: line?.was_due === true ? textOrNull(line.delivery_date) : null,
      readyToComplete: line?.ready_to_complete === true,
      advancesKept: amount(line?.advances_kept),
      advances: rows(read.advances).map((row) => ({
        id: text(row.id, "advance"),
        amount: amount(row.amount),
        receivedOn: text(row.received_on, "advance date"),
        note: textOrNull(row.note),
        returnedOn: textOrNull(row.returned_on),
        returnNote: textOrNull(row.return_note),
      })),
      line: line
        ? {
            cycleId: textOrNull(line.cycle_id),
            state: lineState(line.state),
            achieved: amount(line.achieved),
            achievedCalculated: amount(line.achieved_calculated),
            mark: toMark(line),
            adjustment: toAdjustment(line.override),
          }
        : null,
    };
  }
  if (recurrence !== "weekly" && recurrence !== "monthly") {
    throw new Error("The billing read's repeat is not one MaxOff knows.");
  }
  const cycle = read.cycle ? record(read.cycle, "cycle") : null;
  return {
    kind: "retainer",
    projectId,
    recurrence,
    billing: toBasics(read.billing, recurrence),
    cycle: cycle
      ? {
          cycleId: text(cycle.cycle_id, "cycle"),
          label: textOrNull(cycle.label),
          month: textOrNull(cycle.month),
          amount: amountOrNull(cycle.amount),
          potential: amount(cycle.potential),
          achieved: amount(cycle.achieved),
          achievedCalculated: amount(cycle.achieved_calculated ?? cycle.achieved),
          remaining: amount(cycle.remaining),
          mark: toMark(cycle),
          adjustment: toAdjustment(cycle.override),
        }
      : null,
    planned: rows(read.items).map((row) => ({
      itemId: text(row.item_id, "deliverable"),
      title: text(row.title, "deliverable title"),
      method: plannedMethod(row.method),
      value: amount(row.value),
    })),
    added: rows(read.added).map((row) => ({
      itemId: text(row.item_id, "deliverable"),
      title: text(row.title, "deliverable title"),
      price: row.method === "not_priced" ? null : amountOrNull(row.value),
    })),
  };
}

/** "month" or "week": what one cycle of a retainer is called. */
export function periodWord(recurrence: "weekly" | "monthly"): "month" | "week" {
  return recurrence === "weekly" ? "week" : "month";
}

/** The amount cell's label: "Amount per month", "Amount per week", or a one-time "Amount". */
export function amountLabel(recurrence: BillingRecurrence): string {
  return recurrence === "one_time" ? "Amount" : `Amount per ${periodWord(recurrence)}`;
}

/** An amount as the section reads it: null is "No amount set", ₹0 is "Not billable". */
export function amountText(value: number | null): string {
  if (value === null) return "No amount set";
  return value === 0 ? "Not billable" : formatRupees(value);
}

/** An added deliverable's price: "Not priced" until the Owner sets one, ₹0 is "Not billable". */
export function priceText(price: number | null): string {
  if (price === null) return "Not priced";
  return price === 0 ? "Not billable" : formatRupees(price);
}

/** "Added this month" / "Added this week": the list of deliverables priced on top. */
export function addedHeading(recurrence: "weekly" | "monthly"): string {
  return `Added this ${periodWord(recurrence)}`;
}

/** "November 2026", from any IST date in that month. */
export function monthName(date: string): string {
  return formatIST(istDayStart(`${date.slice(0, 7)}-01`), "MMMM yyyy");
}

/**
 * What the amount sheet says under its title. A retainer's **first** amount covers this IST month
 * on (Q1); a later change covers the current cycle on (decision 3); a one-time project has one.
 */
export function amountSheetNote(
  recurrence: BillingRecurrence,
  pricedFrom: string | null,
  today: string,
): string {
  if (recurrence === "one_time") return "One amount for the whole project.";
  const word = periodWord(recurrence);
  return pricedFrom === null
    ? `From ${monthName(today)} on. Earlier ${word}s stay "No amount set".`
    : `Applies from this ${word} on. Earlier ones keep their amount.`;
}

/** "Set this month's amount" / "Set this week's amount": one earlier cycle, priced alone (Q1). */
export function cycleAmountLabel(recurrence: "weekly" | "monthly"): string {
  return `Set this ${periodWord(recurrence)}'s amount`;
}

/** What the cycle amount sheet says: which cycle it prices, and that the project's amount stays. */
export function cycleAmountNote(label: string | null, recurrence: "weekly" | "monthly"): string {
  return `Only ${label ?? `this ${periodWord(recurrence)}`}. The project's amount is not changed.`;
}

/** "15 Nov": a date as the section's lines say it. */
export function shortDay(date: string): string {
  return formatIST(istDayStart(date), "d MMM");
}

/** "15 Nov 2026": an advance's own date. */
export function longDay(date: string): string {
  return formatIST(istDayStart(date), "d MMM yyyy");
}

/** "Advance received ₹30,000 · Balance on delivery ₹30,000"; null with nothing received. */
export function advanceSummary(fixedAmount: number | null, advancesKept: number): string | null {
  if (advancesKept <= 0) return null;
  const received = `Advance received ${formatRupees(advancesKept)}`;
  if (fixedAmount === null) return received;
  return `${received} · Balance on delivery ${formatRupees(Math.max(fixedAmount - advancesKept, 0))}`;
}

/**
 * Whether a one-time project's section will show its status line ("Was due 15 Nov" / "Ready to
 * complete"), from what the project page already holds (no money read), so the skeleton can
 * reserve the line. The same rule as the read's `was_due` and `ready_to_complete` (DATA-MODEL
 * §7): the project is working, and it is past its delivery date, or it has deliverables and none
 * of them is open or waiting for approval.
 */
export function oneTimeStatusExpected(project: {
  working: boolean;
  deliveryDate: string | null;
  today: string;
  itemStates: readonly string[];
}): boolean {
  if (!project.working) return false;
  if (project.deliveryDate !== null && project.deliveryDate < project.today) return true;
  return (
    project.itemStates.length > 0 &&
    !project.itemStates.some((state) => state === "open" || state === "done")
  );
}

/**
 * A money sheet's line for a closed month (decision 10; WORKFLOWS §7.1): "September is closed. Its
 * report changes only when you correct it." when `date`'s IST month is among `closedMonths` (their
 * first days), else null. Editing stays allowed: the line only says the saved report does not
 * follow (v3.5 U5). `date` is any day of the month; null (nothing dated yet) is never closed.
 */
export function closedMonthLine(
  date: string | null,
  closedMonths: readonly string[],
): string | null {
  if (!date || !/^\d{4}-\d{2}/.test(date)) return null;
  const month = `${date.slice(0, 7)}-01`;
  if (!closedMonths.includes(month)) return null;
  const name = formatIST(istDayStart(month), "MMMM");
  return `${name} is closed. Its report changes only when you correct it.`;
}

/**
 * The closed line of the project's own line (v3.5, decision 10 applied to v2.5's sheets, advisor
 * 26 Nov 2026): the month a retainer's cycle in view or a one-time project counts in, for the
 * sheets that change that line's figures (Adjust, a planned deliverable's value, a one-time
 * amount). Never for Mark billed / Mark not billed: a mark changes no figure.
 */
export function billingLineClosed(
  billing: ProjectBilling,
  closedMonths: readonly string[],
): string | null {
  const month = billing.kind === "retainer" ? (billing.cycle?.month ?? null) : billing.month;
  return closedMonthLine(month, closedMonths);
}

// --- v2.5 "Revenue every day": Billed, the adjustment, planned values ----------------------------

/** "Not billed", or "Billed on 3 Dec · Invoice 42" (the note when there is one). */
export function billedText(mark: BillingMark): string {
  if (!mark.billed || mark.billedOn === null) return "Not billed";
  const on = `Billed on ${shortDay(mark.billedOn)}`;
  return mark.note ? `${on} · ${mark.note}` : on;
}

/**
 * The Adjust row's three lines (decision 6): its small label, the headline figure and the line
 * under it. Adjusted: "Owner adjusted · ‹note›", the Owner's figure, "System calculated ₹Y". As
 * calculated: "Achieved", the figure, "As calculated from approved work".
 */
export function adjustmentLines(figures: {
  achieved: number;
  achievedCalculated: number;
  adjustment: Adjustment | null;
}): { label: string; value: string; detail: string } {
  if (figures.adjustment === null) {
    return {
      label: "Achieved",
      value: formatRupees(figures.achieved),
      detail: "As calculated from approved work",
    };
  }
  const { note, adjustedValue } = figures.adjustment;
  return {
    label: note ? `Owner adjusted · ${note}` : "Owner adjusted",
    value: formatRupees(adjustedValue),
    detail: `System calculated ${formatRupees(figures.achievedCalculated)}`,
  };
}

/**
 * Whether the Adjust row shows: a retainer's cycle in view, or a one-time project once it is
 * completed (the function refuses an adjustment before that, INVALID_STATE).
 */
export function canAdjust(billing: ProjectBilling): boolean {
  if (billing.kind === "retainer") return billing.cycle !== null;
  return billing.line?.state === "completed";
}

/** A planned deliverable's value as its row says it: "₹10,000 · Own value", "₹7,500 · Share". */
export function plannedValueText(item: PlannedDeliverable): string {
  switch (item.method) {
    case "explicit":
      return `${formatRupees(item.value)} · Own value`;
    case "split":
      return `${formatRupees(item.value)} · Share`;
    case "no_amount":
      return "No amount set";
    case "excluded":
      return "Not counted";
  }
}

/** "Planned deliverables · 4": the collapsed list's own line. */
export function plannedHeading(count: number): string {
  return `Planned deliverables · ${count}`;
}

/** What the Set value sheet says: the value comes off the top, the others share the rest. */
export function plannedValueNote(
  title: string,
  amount: number | null,
  recurrence: "weekly" | "monthly",
): string {
  const period = periodWord(recurrence);
  const of =
    amount === null ? `this ${period}'s amount` : `this ${period}'s ${formatRupees(amount)}`;
  return `${title}'s own value comes off the top of ${of}. The other planned deliverables share the rest.`;
}
