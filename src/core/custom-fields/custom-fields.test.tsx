import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CustomFieldsView } from "./components/custom-fields-view";
import {
  describeValue,
  type FieldDefinition,
  type FieldType,
  keyFromLabel,
  optionKeyFromLabel,
  splitDefinitions,
} from "./registry";
import { buildCustomFieldsSchema, validateCustomFields } from "./schema";

let counter = 0;
function definition(type: FieldType, overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-0000000000${String(counter).padStart(2, "0")}`,
    entity: "client",
    clientId: null,
    taskTypeId: null,
    key: `${type}_${counter}`,
    label: `Field ${counter}`,
    helpText: null,
    type,
    options:
      type === "select" || type === "multi_select"
        ? [
            { key: "a", label: "A" },
            { key: "b", label: "B" },
          ]
        : [],
    required: false,
    section: null,
    position: `a${counter}`,
    archivedAt: null,
    ...overrides,
  };
}

describe("keys", () => {
  it("derives a snake_case key from a label, fixed once saved", () => {
    expect(keyFromLabel("Shoot days (planned)")).toBe("shoot_days_planned");
    expect(keyFromLabel("  PO Number  ")).toBe("po_number");
    expect(keyFromLabel("2024 budget")).toBe("budget");
    expect(keyFromLabel("!!!")).toBe("");
    expect(keyFromLabel("x".repeat(60))).toHaveLength(40);
  });

  it("derives an option key from its label", () => {
    expect(optionKeyFromLabel("Gold tier")).toBe("gold-tier");
    expect(optionKeyFromLabel(" Silver ")).toBe("silver");
  });
});

describe("buildCustomFieldsSchema / validateCustomFields (WORKFLOWS §4a)", () => {
  it("parses each type from form strings, storing the option key, a boolean, a number", () => {
    const defs = [
      definition("text", { key: "t" }),
      definition("number", { key: "n" }),
      definition("checkbox", { key: "c" }),
      definition("select", { key: "s" }),
      definition("multi_select", { key: "m" }),
      definition("rating", { key: "r" }),
      definition("color", { key: "col" }),
      definition("date", { key: "d" }),
      definition("url", { key: "u" }),
      definition("email", { key: "e" }),
    ];
    const result = validateCustomFields({
      definitions: defs,
      values: {
        t: "  hello ",
        n: "42.5",
        c: "on",
        s: "b",
        m: ["a", "b"],
        r: "4",
        col: "#e11d48",
        d: "2026-09-27",
        u: "https://x.example/a",
        e: "Hi@Example.com",
      },
    });
    expect(result).toEqual({
      ok: true,
      values: {
        t: "hello",
        n: 42.5,
        c: true,
        s: "b",
        m: ["a", "b"],
        r: 4,
        col: "#E11D48",
        d: "2026-09-27",
        u: "https://x.example/a",
        e: "Hi@Example.com",
      },
    });
  });

  it("leaves empty optional fields out and refuses empty required ones, keyed by path", () => {
    const defs = [
      definition("text", { key: "opt" }),
      definition("text", { key: "req", required: true }),
    ];
    expect(validateCustomFields({ definitions: defs, values: { opt: "", req: "x" } })).toEqual({
      ok: true,
      values: { req: "x" },
    });
    const missing = validateCustomFields({ definitions: defs, values: { opt: "y" } });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.fieldErrors).toEqual({ "customFields.req": ["This field is required."] });
    }
  });

  it("refuses a value outside the options, a bad number, a bad rating", () => {
    const defs = [
      definition("select", { key: "s" }),
      definition("number", { key: "n" }),
      definition("rating", { key: "r" }),
      definition("multi_select", { key: "m" }),
    ];
    const bad = validateCustomFields({
      definitions: defs,
      values: { s: "zzz", n: "abc", r: "9", m: ["a", "nope"] },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(Object.keys(bad.fieldErrors).sort()).toEqual([
        "customFields.m.1",
        "customFields.n",
        "customFields.r",
        "customFields.s",
      ]);
    }
  });

  it("keeps an archived field's previous value and drops unknown keys", () => {
    const defs = [
      definition("text", { key: "live" }),
      definition("text", { key: "old", archivedAt: "2026-09-01T00:00:00Z" }),
    ];
    const result = validateCustomFields({
      definitions: defs,
      values: { live: "a", old: "typed anyway", stray: 1 },
      previous: { old: "kept", gone: "dropped" },
    });
    expect(result).toEqual({ ok: true, values: { live: "a", old: "kept" } });
  });

  it("the built schema strips keys with no active definition", () => {
    const schema = buildCustomFieldsSchema([definition("text", { key: "k" })]);
    expect(schema.parse({ k: "v", other: 1 })).toEqual({ k: "v" });
  });
});

describe("describeValue and the view", () => {
  it("names the option, says Yes/No, formats a rating", () => {
    const select = definition("select", { key: "s" });
    expect(describeValue(select, "b")).toBe("B");
    expect(describeValue(definition("checkbox"), true)).toBe("Yes");
    expect(describeValue(definition("checkbox"), false)).toBe("No");
    expect(describeValue(definition("rating"), 3)).toBe("3 / 5");
    expect(describeValue(definition("multi_select"), ["a", "b"])).toBe("A, B");
    expect(describeValue(definition("text"), "")).toBeNull();
  });

  it("splits live and archived definitions in position order", () => {
    const a = definition("text", { position: "a2" });
    const b = definition("text", { position: "a1" });
    const z = definition("text", { position: "a0", archivedAt: "2026-09-01T00:00:00Z" });
    const split = splitDefinitions([a, b, z]);
    expect(split.active.map((d) => d.id)).toEqual([b.id, a.id]);
    expect(split.archived.map((d) => d.id)).toEqual([z.id]);
  });

  it("renders a dash for an empty value and the archived section only when a value is kept", () => {
    const live = definition("text", { key: "live", label: "Live" });
    const archived = definition("text", {
      key: "old",
      label: "Old",
      archivedAt: "2026-09-01T00:00:00Z",
    });
    const empty = renderToStaticMarkup(
      <CustomFieldsView definitions={[live, archived]} values={{}} />,
    );
    expect(empty).toContain("—");
    expect(empty).not.toContain("Archived fields");
    const kept = renderToStaticMarkup(
      <CustomFieldsView definitions={[live, archived]} values={{ live: "x", old: "y" }} />,
    );
    expect(kept).toContain("Archived fields");
    expect(kept).toContain("Old");
    expect(renderToStaticMarkup(<CustomFieldsView definitions={[]} values={{}} />)).toBe("");
  });
});
