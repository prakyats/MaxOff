/**
 * Whole rupees in (9.2): every billing amount is typed and stored as whole rupees. How an amount
 * reads is `formatRupees` (`core/lib/rupees`), the one formatter.
 */

/** `numeric(12,2)`: anything at or above this cannot be stored. */
export const AMOUNT_LIMIT = 10_000_000_000;

export type RupeeEntry = { ok: true; value: number } | { ok: false; message: string };

/**
 * A typed amount as **whole rupees** (every billing amount is; the database checks it again):
 * digits with optional comma grouping and an optional "₹", "40,000" → 40000. Paise, a negative
 * and anything that is not a number are refused in words. Zero is an amount ("Not billable")
 * unless `positive` (an advance).
 */
export function parseWholeRupees(
  text: string,
  { positive = false }: { positive?: boolean } = {},
): RupeeEntry {
  const cleaned = text.trim().replace(/^₹\s*/, "").replace(/,/g, "");
  if (cleaned === "") return { ok: false, message: "Enter the amount in rupees." };
  if (/^-\d/.test(cleaned)) return { ok: false, message: "The amount can't be less than ₹0." };
  if (/^\d+\.\d+$/.test(cleaned) && !/^\d+\.0{1,2}$/.test(cleaned)) {
    return { ok: false, message: "Whole rupees only, no paise." };
  }
  if (!/^\d+(\.0{1,2})?$/.test(cleaned)) {
    return { ok: false, message: "Enter the amount in rupees, e.g. 40000." };
  }
  const value = Number(cleaned);
  if (value >= AMOUNT_LIMIT) return { ok: false, message: "That amount is too large." };
  if (positive && value === 0) return { ok: false, message: "Enter an amount above ₹0." };
  return { ok: true, value };
}
