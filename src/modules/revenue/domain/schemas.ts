import { z } from "zod";

import { todayIST } from "@/core/time";

import { BILLING_CATEGORIES } from "./billing";
import { AMOUNT_LIMIT } from "./money";

/** The longest note an advance (or its return) carries: the database's check. */
export const ADVANCE_NOTE_MAX_LENGTH = 500;

/** Whole rupees, zero or more ("Not billable" is ₹0); the database checks it again. */
const wholeRupees = z
  .number({ error: "Enter the amount in rupees." })
  .int("Whole rupees only, no paise.")
  .min(0, "The amount can't be less than ₹0.")
  .lt(AMOUNT_LIMIT, "That amount is too large.");

/** A day up to today (IST): money is never received or returned in the future. */
const dayUpToToday = z.iso
  .date({ error: "Pick a day up to today." })
  .refine((date) => date <= todayIST(), "Pick a day up to today.");

const note = z
  .string()
  .trim()
  .max(ADVANCE_NOTE_MAX_LENGTH, `Keep it under ${ADVANCE_NOTE_MAX_LENGTH} characters.`)
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .default(null);

/** A project's amount: a retainer's per cycle, a one-time project's lump sum. */
export const setAmountSchema = z.object({ projectId: z.uuid(), amount: wholeRupees });
export type SetAmountInput = z.input<typeof setAmountSchema>;

/** One retainer cycle's own amount (a cycle from before the project's first amount, Q1). */
export const setCycleAmountSchema = z.object({ cycleId: z.uuid(), amount: wholeRupees });
export type SetCycleAmountInput = z.input<typeof setCycleAmountSchema>;

export const setCategorySchema = z.object({
  projectId: z.uuid(),
  category: z.enum(BILLING_CATEGORIES, { error: "Choose a category." }),
});
export type SetCategoryInput = z.input<typeof setCategorySchema>;

/** The price of a deliverable added on top of a retainer cycle's amount. */
export const setPriceSchema = z.object({ itemId: z.uuid(), price: wholeRupees });
export type SetPriceInput = z.input<typeof setPriceSchema>;

export const recordAdvanceSchema = z.object({
  projectId: z.uuid(),
  amount: wholeRupees.positive("Enter an amount above ₹0."),
  receivedOn: dayUpToToday,
  note,
});
export type RecordAdvanceInput = z.input<typeof recordAdvanceSchema>;

export const returnAdvanceSchema = z.object({
  advanceId: z.uuid(),
  returnedOn: dayUpToToday,
  note,
});
export type ReturnAdvanceInput = z.input<typeof returnAdvanceSchema>;

// --- v2.5 "Revenue every day" ---------------------------------------------------------------------

/** The most cycles one "Mark all billed" sends: the same as `billing_mark_unbilled`'s own limit (one transaction). */
export const MARK_ALL_MAX = 2000;

/** A note the Owner must write (an adjustment and its undoing): 1–500 characters. */
const requiredNote = z
  .string({ error: "Add a note saying why." })
  .trim()
  .min(1, "Add a note saying why.")
  .max(ADVANCE_NOTE_MAX_LENGTH, `Keep it under ${ADVANCE_NOTE_MAX_LENGTH} characters.`);

/** Billed (with its day, up to today, and an optional note) for one cycle or a one-time project's. */
export const markBilledSchema = z.object({ cycleId: z.uuid(), billedOn: dayUpToToday, note });
export type MarkBilledInput = z.input<typeof markBilledSchema>;

/** Back to Not billed. */
export const markNotBilledSchema = z.object({ cycleId: z.uuid() });
export type MarkNotBilledInput = z.input<typeof markNotBilledSchema>;

/** "Mark all N billed" on the Revenue page: the month's cycles not billed yet. */
export const markAllBilledSchema = z.object({
  cycleIds: z
    .array(z.uuid())
    .min(1, "Nothing to mark.")
    .max(MARK_ALL_MAX, "Too many to mark at once."),
  billedOn: dayUpToToday,
});
export type MarkAllBilledInput = z.input<typeof markAllBilledSchema>;

/** The Owner's adjusted Achieved of a retainer cycle or a completed one-time project. */
export const adjustSchema = z.object({
  scope: z.enum(["cycle", "project"]),
  refId: z.uuid(),
  value: wholeRupees,
  note: requiredNote,
});
export type AdjustInput = z.input<typeof adjustSchema>;

/** "Back to calculated", with the note saying why. */
export const clearAdjustSchema = z.object({
  scope: z.enum(["cycle", "project"]),
  refId: z.uuid(),
  note: requiredNote,
});
export type ClearAdjustInput = z.input<typeof clearAdjustSchema>;

/** A planned deliverable's own value (off the top), or null: back to its share. */
export const plannedValueSchema = z.object({ itemId: z.uuid(), value: wholeRupees.nullable() });
export type PlannedValueInput = z.input<typeof plannedValueSchema>;

/** A page of the Billing history: the newest `limit` rows (20 at first, 200 at most). */
export const historySchema = z.object({
  projectId: z.uuid(),
  limit: z.coerce.number().int().min(1).max(200),
  /** A one-time project: its single cycle is never named in the lines ("1" in the query). */
  oneTime: z.enum(["0", "1"]).transform((value) => value === "1"),
});
export type HistoryInput = z.input<typeof historySchema>;
