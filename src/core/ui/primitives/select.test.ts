import { describe, expect, it } from "vitest";

import { type Labelled, labelOf } from "./select";

function trigger(
  attributes: Record<string, string>,
  label?: string,
  byId: Record<string, string> = {},
): Labelled {
  return {
    getAttribute: (name) => attributes[name] ?? null,
    labels: label === undefined ? [] : [{ textContent: label }],
    ownerDocument: {
      getElementById: (id) => (id in byId ? { textContent: byId[id] ?? null } : null),
    },
  };
}

describe("the phone select sheet's title is the field's label", () => {
  it("prefers aria-label (a filter), then aria-labelledby, then the <label for>", () => {
    expect(labelOf(trigger({ "aria-label": "State" }, "Ignored"))).toBe("State");
    expect(
      labelOf(trigger({ "aria-labelledby": "a b" }, "Ignored", { a: "Kind", b: "of leave" })),
    ).toBe("Kind of leave");
    expect(labelOf(trigger({}, " Kind of leave "))).toBe("Kind of leave");
  });

  it("falls back when nothing names the trigger", () => {
    expect(labelOf(trigger({}))).toBe("Choose");
    expect(labelOf(null)).toBe("Choose");
    expect(labelOf(trigger({ "aria-labelledby": "missing" }))).toBe("Choose");
  });
});
