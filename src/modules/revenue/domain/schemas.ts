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
