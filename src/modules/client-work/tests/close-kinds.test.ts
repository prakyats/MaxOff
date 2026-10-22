import { describe, expect, it } from "vitest";

import { describeProjectActivity, type ActivityEntry } from "../domain/activity";
import { CLOSE_KINDS, closeKindLabel, closeKindWords, isCloseKind } from "../domain/close-kinds";
import { alsoAddCopy, itemListPeriods } from "../domain/periods";

describe("close kinds (v1.9 W1-db)", () => {
  it("has exactly the two kinds the database checks", () => {
    expect(CLOSE_KINDS).toEqual(["not_needed", "not_delivered"]);
    expect(isCloseKind("not_needed")).toBe(true);
    expect(isCloseKind("not_delivered")).toBe(true);
    expect(isCloseKind("lost")).toBe(false);
    expect(isCloseKind(null)).toBe(false);
  });

  it("names the period of a repeating project, none for a one-time one", () => {
    expect(closeKindLabel("not_needed", "monthly")).toBe("Not needed this month");
    expect(closeKindLabel("not_needed", "weekly")).toBe("Not needed this week");
    expect(closeKindLabel("not_needed", "one_time")).toBe("Not needed");
    expect(closeKindLabel("not_delivered", "monthly")).toBe("Not delivered");
    expect(closeKindLabel("not_delivered", "one_time")).toBe("Not delivered");
    expect(closeKindWords("not_needed")).toBe("not needed");
    expect(closeKindWords("not_delivered")).toBe("not delivered");
  });
});

describe("the history of a close kind (v1.9 W1-db)", () => {
  const entry = (over: Partial<ActivityEntry>): ActivityEntry => ({
    id: 1,
    actorId: null,
    entity: "project_items",
    entityId: "item-1",
    action: "cancelled",
    old: {},
    new: {},
    meta: {},
    at: "2026-10-22T05:00:00Z",
    ...over,
  });
  const context = { names: {}, items: { "item-1": "Reel 2" }, stages: {} };
  const said = (over: Partial<ActivityEntry>) => describeProjectActivity(entry(over), context);

  it("a close says its kind, an older close says none", () => {
    expect(said({ new: { close_kind: "not_delivered", cancelled_reason: "Late" } })).toMatchObject({
      text: "closed Reel 2 as not delivered",
      note: "Late",
    });
    expect(said({ action: "closed", meta: { close_kind: "not_needed" } })?.text).toBe(
      "closed Reel 2 as not needed",
    );
    expect(said({ new: { cancelled_reason: "Late" } })?.text).toBe("closed Reel 2");
    expect(said({ action: "closed", meta: { close_kind: null } })?.text).toBe("closed Reel 2");
  });

  it("the Owner setting, changing and clearing the kind", () => {
    expect(said({ action: "close_kind_set", new: { close_kind: "not_needed" } })?.text).toBe(
      "marked Reel 2's close as not needed",
    );
    expect(
      said({
        action: "close_kind_set",
        old: { close_kind: "not_needed" },
        new: { close_kind: "not_delivered" },
      })?.text,
    ).toBe("marked Reel 2's close as not delivered");
    expect(said({ action: "close_kind_set", new: {} })?.text).toBe("changed why Reel 2 was closed");
    expect(said({ action: "close_kind_cleared", new: { close_kind: null } })?.text).toBe(
      "cleared why Reel 2 was closed",
    );
  });
});

describe('"Also add ‹title› to ‹period›?" (v1.9 W1-db)', () => {
  const october = {
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    label: "October 2026",
    itemListCopied: true,
  };

  it("asks while the running cycle can take the line, Add too first", () => {
    const periods = itemListPeriods("monthly", "2026-10-22", [october], true);
    expect(periods).not.toBeNull();
    expect(alsoAddCopy(periods!, "  Extra reel ")).toEqual({
      question: "Also add Extra reel to October 2026?",
      addToo: "Add to October 2026 too",
      listOnly: "From November 2026 only",
      addedBoth: "Extra reel added to October 2026 and every month from November 2026",
      addedListOnly: "Extra reel added from November 2026",
    });
  });

  it("names a weekly project's periods", () => {
    const week = {
      periodStart: "2026-10-19",
      periodEnd: "2026-10-25",
      label: "19–25 Oct 2026",
      itemListCopied: true,
    };
    const periods = itemListPeriods("weekly", "2026-10-22", [week], true);
    expect(alsoAddCopy(periods!, "Post")?.question).toBe("Also add Post to 19–25 Oct 2026?");
    expect(alsoAddCopy(periods!, "Post")?.addedBoth).toBe(
      "Post added to 19–25 Oct 2026 and every week from 26 Oct–1 Nov 2026",
    );
  });

  it("does not ask without a running cycle that can take it", () => {
    const closed = itemListPeriods("monthly", "2026-10-22", [october], false);
    expect(alsoAddCopy(closed!, "Extra reel")).toBeNull();
    const waiting = itemListPeriods(
      "monthly",
      "2026-10-22",
      [{ ...october, itemListCopied: false }],
      true,
    );
    expect(alsoAddCopy(waiting!, "Extra reel")).toBeNull();
    expect(itemListPeriods("monthly", "2026-10-22", [], true)?.running).toBeNull();
  });
});
