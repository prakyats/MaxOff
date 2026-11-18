/**
 * How an amount in rupees reads, everywhere MaxOff shows one: a member's own expense claims and
 * the Owner's revenue (v2.1). In core so `modules/revenue` doesn't import from `modules/expenses`
 * (modules are isolated); it formats a number and knows nothing about who may see it.
 */

const RUPEES = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const RUPEES_PAISE = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "₹1,200", "₹42.50": whole rupees stay whole, paise always show two digits. */
export function formatRupees(amount: number): string {
  return Number.isInteger(amount) ? RUPEES.format(amount) : RUPEES_PAISE.format(amount);
}
