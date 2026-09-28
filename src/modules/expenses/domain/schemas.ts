import { z } from "zod";

import { CLAIM_AMOUNT_LIMIT, CLAIM_NOTE_MAX_LENGTH } from "./claims";

const isoDate = z.iso.date({ error: "Pick the day of the expense." });

/**
 * At most two decimals, read in paise with a tolerance: `150.1 * 100` is 15009.999999999998 in
 * floating point, so an exact comparison would refuse valid amounts (3bB review must-fix).
 */
export function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

/**
 * A new claim (PRODUCT §4.18, 3b.3): the date (the database checks the window), the amount in
 * rupees with at most two decimals, a category, what it was for, and the receipt when there is
 * one. The receipt amount is the database's to check: it is the Owner's setting.
 */
export const submitClaimSchema = z.object({
  expenseDate: isoDate,
  amount: z
    .number({ error: "Enter the amount in rupees." })
    .positive("Enter an amount above ₹0.")
    .lt(CLAIM_AMOUNT_LIMIT, "That amount is too large.")
    .refine(hasAtMostTwoDecimals, "Use two decimals at most."),
  categoryId: z.uuid({ error: "Choose a category." }),
  note: z
    .string()
    .trim()
    .min(1, "Say what it was for.")
    .max(CLAIM_NOTE_MAX_LENGTH, `Keep it under ${CLAIM_NOTE_MAX_LENGTH} characters.`),
  receiptFileId: z.uuid().nullable().default(null),
});
export type SubmitClaimInput = z.input<typeof submitClaimSchema>;

export const claimIdSchema = z.object({ claimId: z.uuid() });
export type ClaimIdInput = z.input<typeof claimIdSchema>;

export const rejectClaimSchema = z.object({
  claimId: z.uuid(),
  reason: z
    .string()
    .trim()
    .min(1, "Say why, so they know.")
    .max(1000, "Keep it under 1000 characters."),
});
export type RejectClaimInput = z.input<typeof rejectClaimSchema>;

/** Mark paid: one claim or several at once, on a date (default today, IST). */
export const markPaidSchema = z.object({
  claimIds: z.array(z.uuid()).min(1, "Nothing to mark paid.").max(200),
  paidOn: z.iso.date({ error: "Pick the payment date." }).nullable().default(null),
});
export type MarkPaidInput = z.input<typeof markPaidSchema>;

/** The Owner's receipt amount (Settings → Expenses): whole rupees or paise, zero or more. */
export const receiptAboveSchema = z.object({
  receiptAbove: z
    .number({ error: "Enter an amount in rupees." })
    .min(0, "Zero or more.")
    .lt(CLAIM_AMOUNT_LIMIT, "That amount is too large.")
    .refine(hasAtMostTwoDecimals, "Use two decimals at most."),
});
export type ReceiptAboveInput = z.input<typeof receiptAboveSchema>;
