/**
 * The TypeScript twin of the revenue views' arithmetic (migration `money_tables`, WORKFLOWS §6):
 * `item_values_v`'s split and `revenue_project_lines_v`'s month. The views are the source of truth for
 * every stored figure; this is for previews on the Owner's Billing screens ("3 deliverables · ₹3,333 each")
 * and is unit-tested against the same cases as pgTAP 144, so the two can't drift unnoticed.
 */

export type ValueMethod = "explicit" | "split" | "added" | "not_priced" | "no_amount" | "excluded";

export interface AllocationItem {
  id: string;
  /** Sort key within the cycle (the deliverable's position, compared as plain code units like `collate "C"`). */
  position: string;
  /** Created after the cycle's item list (R4): priced on top, never part of the split. */
  added: boolean;
  /** The Owner's own value in rupees, or null. */
  explicitValue: number | null;
  /** False for a "Not needed" close or one cancelled before its cycle started. */
  inPotential: boolean;
}

export interface AllocatedItem {
  id: string;
  method: ValueMethod;
  /** Rupees, to the paisa. */
  value: number;
}

const toPaise = (rupees: number): number => Math.round(rupees * 100);
const toRupees = (paise: number): number => paise / 100;

function byPosition(a: AllocationItem, b: AllocationItem): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * A retainer cycle's amount over its deliverables: explicit plan values come off the top, the rest is split
 * evenly to the paisa with the leftover paise on the first by position; added work is worth its own price
 * (nothing until priced) on top of the amount.
 */
export function allocateCycle(
  cycleAmount: number | null,
  items: AllocationItem[],
): AllocatedItem[] {
  const counted = items.filter((item) => !item.added && item.inPotential);
  const explicitPaise = counted.reduce(
    (sum, item) => sum + (item.explicitValue === null ? 0 : toPaise(item.explicitValue)),
    0,
  );
  const shared = counted.filter((item) => item.explicitValue === null).sort(byPosition);
  const restPaise = cycleAmount === null ? 0 : Math.max(toPaise(cycleAmount) - explicitPaise, 0);
  const sharePaise = shared.length === 0 ? 0 : Math.floor(restPaise / shared.length);
  const firstPaise = restPaise - sharePaise * Math.max(shared.length - 1, 0);
  const firstId = shared[0]?.id;

  return items.map((item) => {
    if (!item.inPotential) return { id: item.id, method: "excluded", value: 0 };
    if (item.added) {
      return item.explicitValue === null
        ? { id: item.id, method: "not_priced", value: 0 }
        : { id: item.id, method: "added", value: item.explicitValue };
    }
    if (item.explicitValue !== null)
      return { id: item.id, method: "explicit", value: item.explicitValue };
    if (cycleAmount === null) return { id: item.id, method: "no_amount", value: 0 };
    return {
      id: item.id,
      method: "split",
      value: toRupees(item.id === firstId ? firstPaise : sharePaise),
    };
  });
}

/** Potential of a cycle: every counted value, the priced extras on top. */
export function cyclePotential(allocated: AllocatedItem[]): number {
  return toRupees(allocated.reduce((sum, item) => sum + toPaise(item.value), 0));
}

export interface OneTimeLineInput {
  state: "open" | "in_progress" | "completed" | "cancelled";
  /** IST dates, `yyyy-MM-dd`. */
  deliveryDate: string;
  completedOn: string | null;
  cancelledOn: string | null;
  today: string;
}

const monthOf = (day: string): string => `${day.slice(0, 7)}-01`;

/**
 * The IST month a one-time project's lump sum sits in (decision 2, 2a, 2c): the completion month once
 * completed, the cancellation month once cancelled, the current month while overdue, else the delivery month.
 */
export function oneTimeMonth(line: OneTimeLineInput): { month: string; wasDue: boolean } {
  if (line.state === "completed" && line.completedOn)
    return { month: monthOf(line.completedOn), wasDue: false };
  if (line.state === "cancelled" && line.cancelledOn)
    return { month: monthOf(line.cancelledOn), wasDue: false };
  const wasDue = line.deliveryDate < line.today;
  const delivery = monthOf(line.deliveryDate);
  const current = monthOf(line.today);
  return { month: delivery < current ? current : delivery, wasDue };
}

/** Q1: an amount counts only from the month it was first entered; an earlier month reads "No amount set". */
export function amountInMonth(
  amount: number | null,
  pricedFrom: string | null,
  month: string,
): number | null {
  return pricedFrom !== null && month >= pricedFrom ? amount : null;
}
