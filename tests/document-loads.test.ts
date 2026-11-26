import { describe, expect, it } from "vitest";

import { TRAVERSAL_CAP_MS, TraversalAllowance } from "../e2e/traversal-allowance";

/**
 * The reload guard's one exception for a traversal Playwright resolved early
 * (`e2e/traversal-allowance.ts`, fix-goback-guard): after a `null` goBack whose target is another
 * document, exactly one load of that target, within the cap. Everything else stays a surprise.
 */
describe("TraversalAllowance", () => {
  const target = "http://localhost:3100/today";

  it("lets the null goBack's target load through", () => {
    const allowance = new TraversalAllowance();
    allowance.grant(target, 1_000);
    expect(allowance.take(target, 1_020)).toBe(true);
  });

  it("fails a load of a different URL", () => {
    const allowance = new TraversalAllowance();
    allowance.grant(target, 1_000);
    expect(allowance.take("http://localhost:3100/calendar", 1_020)).toBe(false);
  });

  it("lets only one load through", () => {
    const allowance = new TraversalAllowance();
    allowance.grant(target, 1_000);
    expect(allowance.take(target, 1_020)).toBe(true);
    expect(allowance.take(target, 1_040)).toBe(false);
  });

  it("fails the target once the cap has passed", () => {
    const allowance = new TraversalAllowance();
    allowance.grant(target, 1_000);
    expect(allowance.take(target, 1_000 + TRAVERSAL_CAP_MS + 1)).toBe(false);
  });

  it("allows nothing without a grant", () => {
    expect(new TraversalAllowance().take(target, 0)).toBe(false);
  });

  it("compares URLs as the browser writes them", () => {
    const allowance = new TraversalAllowance();
    allowance.grant("http://localhost:3100/today", 0);
    expect(allowance.take("http://LOCALHOST:3100/today", 10)).toBe(true);
  });
});
