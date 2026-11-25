import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => vi.fn());
vi.mock("@/core/observability/capture", () => ({ captureException: captured }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

import { BillingSection } from "../components/billing-section";
import { BillingSkeleton } from "../components/billing-skeleton";
import { toProjectBilling } from "../domain/billing";

const ID = "7f3b6d0e-1c2a-4b5d-8e9f-0a1b2c3d4e5f";
const TODAY = "2026-11-19";

/** The 9.2 review: a failed billing read is the section's own state, never the page's. */
describe("BillingSection: a read that fails", () => {
  beforeEach(() => captured.mockClear());

  it("draws its error state with a retry instead of throwing, and reports the failure once", async () => {
    const failure = new Error("the read failed");
    const out = renderToStaticMarkup(
      await BillingSection({ read: Promise.reject(failure), today: TODAY }),
    );
    expect(out).toContain('data-slot="project-billing"');
    expect(out).toContain('data-slot="billing-error"');
    expect(out).toContain("Billing couldn&#x27;t load.");
    expect(out).toContain("Try again");
    // Nothing of the section proper: no amount row, no control, no rupee sign.
    expect(out).not.toContain('data-slot="billing-amount"');
    expect(out).not.toContain("₹");
    expect(captured).toHaveBeenCalledTimes(1);
    expect(captured).toHaveBeenCalledWith(failure);
  });

  it("does the same for an answer it cannot read (a parse error)", async () => {
    const read = Promise.resolve({ project_id: ID, recurrence: "yearly" }).then(toProjectBilling);
    const out = renderToStaticMarkup(await BillingSection({ read, today: TODAY }));
    expect(out).toContain('data-slot="billing-error"');
    expect(captured).toHaveBeenCalledTimes(1);
  });

  it("draws the section, and reports nothing, when the read answers", async () => {
    const read = Promise.resolve(
      toProjectBilling({
        project_id: ID,
        recurrence: "monthly",
        billing: { category: "retainer", category_is_default: true, cycle_amount: 40000 },
        cycle: null,
        added: [],
      }),
    );
    const out = renderToStaticMarkup(await BillingSection({ read, today: TODAY }));
    expect(out).toContain('data-slot="billing-amount"');
    expect(out).toContain("₹40,000");
    expect(out).not.toContain('data-slot="billing-error"');
    expect(captured).not.toHaveBeenCalled();
  });
});

/** v2.5: the section's fixed rows, in the order its skeleton draws them. */
describe("BillingSection: v2.5's rows", () => {
  const at = (out: string, slots: string[]) =>
    slots.map((slot) => out.indexOf(`data-slot="${slot}"`));

  it("a retainer's cycle: Billed, Adjust, the planned list and the history after the figures", async () => {
    const read = Promise.resolve(
      toProjectBilling({
        project_id: ID,
        recurrence: "monthly",
        billing: { category: "retainer", category_is_default: true, cycle_amount: 40000 },
        cycle: {
          cycle_id: ID,
          label: "November 2026",
          amount: 40000,
          potential: 40000,
          achieved: 9000,
          achieved_calculated: 10000,
          remaining: 31000,
          billing_status: "billed",
          billed_on: "2026-11-03",
          override: { adjusted_value: 9000, calculated_value: 10000, note: "Discount", at: "x" },
        },
        items: [{ item_id: ID, title: "Reel 1", method: "explicit", value: 10000 }],
        added: [],
      }),
    );
    const out = renderToStaticMarkup(await BillingSection({ read, today: TODAY }));
    const order = at(out, [
      "billing-cycle",
      "billing-billed",
      "billing-adjust",
      "billing-planned",
      "billing-history",
    ]);
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out).toContain("Billed on 3 Nov");
    expect(out).toContain("Mark not billed");
    expect(out).toContain("Owner adjusted · Discount");
    expect(out).toContain("System calculated ₹10,000");
    expect(out).toContain("Back to calculated");
    expect(out).toContain("Planned deliverables · 1");
    expect(out).toContain("₹10,000 · Own value");
    expect(out).toContain("Back to share");
  });

  it("a one-time project: Billed and the history; Adjust only once completed", async () => {
    const oneTime = (state: string) =>
      Promise.resolve(
        toProjectBilling({
          project_id: ID,
          recurrence: "one_time",
          billing: { category: "project", category_is_default: true, fixed_amount: 60000 },
          line: { state, cycle_id: ID, achieved: 60000, achieved_calculated: 60000 },
          advances: [],
        }),
      );
    const working = renderToStaticMarkup(
      await BillingSection({ read: oneTime("in_progress"), today: TODAY }),
    );
    expect(working).toContain('data-slot="billing-billed"');
    expect(working).toContain('data-slot="billing-history"');
    expect(working).not.toContain('data-slot="billing-adjust"');
    const done = renderToStaticMarkup(
      await BillingSection({ read: oneTime("completed"), today: TODAY }),
    );
    const order = at(done, [
      "billing-billed",
      "billing-adjust",
      "billing-history",
      "billing-advances",
    ]);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(order[0]).toBeGreaterThan(-1);
  });
});

/** The skeleton's rows match the section's for each variant the page can tell apart. */
describe("BillingSkeleton: its variants", () => {
  const rows = (out: string) => out.split('data-row=""').length - 1;

  const order = (out: string, slots: string[]) =>
    slots.map((slot) => out.indexOf(`data-slot="${slot}"`));

  it("a retainer with a cycle in view: Category, Amount, the figures, then v2.5's four rows", () => {
    const out = renderToStaticMarkup(<BillingSkeleton retainer />);
    expect(rows(out)).toBe(7);
    const at = order(out, [
      "billing-skeleton-billed",
      "billing-skeleton-adjust",
      "billing-skeleton-planned",
      "billing-skeleton-history",
    ]);
    expect(at.every((index) => index > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("a retainer with no cycle in view: Category, Amount and Billing history only", () => {
    const out = renderToStaticMarkup(<BillingSkeleton retainer cycle={false} />);
    expect(rows(out)).toBe(3);
    expect(out).toContain("billing-skeleton-history");
    expect(out).not.toContain("billing-skeleton-billed");
  });

  it("a one-time project: Category, Amount, Billed, Billing history and Advances", () => {
    const out = renderToStaticMarkup(<BillingSkeleton retainer={false} />);
    expect(rows(out)).toBe(5);
    expect(out).not.toContain("billing-skeleton-status");
    expect(out).not.toContain("billing-skeleton-adjust");
  });

  it("a one-time project that is late or ready: its status line before Billed", () => {
    const out = renderToStaticMarkup(<BillingSkeleton retainer={false} status />);
    expect(rows(out)).toBe(6);
    const at = order(out, ["billing-skeleton-status", "billing-skeleton-billed"]);
    expect(at[0]).toBeGreaterThan(-1);
    expect(at[0]).toBeLessThan(at[1]!);
  });

  it("a completed one-time project: its Adjust row; one without a cycle: no Billed row", () => {
    expect(rows(renderToStaticMarkup(<BillingSkeleton retainer={false} completed />))).toBe(6);
    const none = renderToStaticMarkup(<BillingSkeleton retainer={false} cycle={false} />);
    expect(rows(none)).toBe(4);
    expect(none).not.toContain("billing-skeleton-billed");
  });
});
