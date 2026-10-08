import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

describe("the trigger keeps its own slot (6B review later item (k))", () => {
  it("sets data-slot after the caller's props, so a caller's data-slot can never replace it", () => {
    const source = readFileSync(fileURLToPath(new URL("./select.tsx", import.meta.url)), "utf8");
    const trigger = source.slice(source.indexOf("function SelectTrigger("));
    const tag = trigger.slice(
      trigger.indexOf("<SelectPrimitive.Trigger"),
      trigger.indexOf("{children}"),
    );
    expect(tag.indexOf("{...props}")).toBeGreaterThan(-1);
    expect(tag.indexOf('data-slot="select-trigger"')).toBeGreaterThan(tag.indexOf("{...props}"));
    expect(tag.match(/data-slot=/g)).toHaveLength(1);
  });
});
