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

/** The skeleton's rows match the section's for each variant the page can tell apart. */
describe("BillingSkeleton: its variants", () => {
  const rows = (out: string) => out.split('data-row=""').length - 1;

  it("a retainer with a cycle in view: Category, Amount and the cycle's figures", () => {
    expect(rows(renderToStaticMarkup(<BillingSkeleton retainer />))).toBe(3);
  });

  it("a retainer with no cycle in view: Category and Amount only", () => {
    expect(rows(renderToStaticMarkup(<BillingSkeleton retainer cycle={false} />))).toBe(2);
  });

  it("a one-time project: Category, Amount and Advances", () => {
    const out = renderToStaticMarkup(<BillingSkeleton retainer={false} />);
    expect(rows(out)).toBe(3);
    expect(out).not.toContain("billing-skeleton-status");
  });

  it("a one-time project that is late or ready: its status line before Advances", () => {
    const out = renderToStaticMarkup(<BillingSkeleton retainer={false} status />);
    expect(rows(out)).toBe(4);
    expect(out.indexOf("billing-skeleton-status")).toBeGreaterThan(-1);
  });
});
