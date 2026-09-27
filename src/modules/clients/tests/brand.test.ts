import { describe, expect, it } from "vitest";

import {
  brandChanges,
  brandDraft,
  brandPayload,
  hexInput,
  isHex,
  moveRow,
} from "../domain/brand-changes";
import { updateBrandSchema } from "../domain/schemas";

const WHOSE = "Sharma Weddings'";
const before = brandDraft(
  [
    { name: "Primary", hex: "#E11D48" },
    { name: "Ink", hex: "#111111" },
  ],
  [{ family: "Inter", usage: "headings" }],
);

describe("the brand's swatch and font lists (3B review)", () => {
  it("keys every row, and sends the rows in order without their keys", () => {
    expect(before.colors.map((row) => row.key)).toEqual(["c0", "c1"]);
    expect(before.fonts[0]).toEqual({ key: "f0", family: "Inter", usage: "headings" });
    expect(
      brandPayload({
        colors: [{ key: "x", name: " Primary ", hex: "#E11D48" }],
        fonts: [{ key: "y", family: "Lora", usage: "" }],
      }),
    ).toEqual({
      colors: [{ name: "Primary", hex: "#E11D48" }],
      fonts: [{ family: "Lora", usage: "" }],
    });
  });

  it("types a hex as # and six upper-case digits, whatever is pasted", () => {
    expect(hexInput("e11d48")).toBe("#E11D48");
    expect(hexInput("#E1 1D 48 ff")).toBe("#E11D48");
    expect(hexInput("zz")).toBe("#");
    expect(isHex("#e11d48")).toBe(true);
    expect(isHex("#E11D4")).toBe(false);
  });

  it("moves a row up or down, and nowhere past either end", () => {
    expect(moveRow(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveRow(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveRow(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });

  it("names nothing when nothing changed", () => {
    expect(brandChanges(WHOSE, before, structuredClone(before))).toEqual([]);
  });

  it("names each addition, edit and removal", () => {
    const after = {
      colors: [
        { key: "c0", name: "Primary", hex: "#BE123C" },
        { key: "new-1", name: "Gold", hex: "#D4AF37" },
      ],
      fonts: [{ key: "f0", family: "Inter", usage: "" }],
    };
    expect(brandChanges(WHOSE, before, after)).toEqual([
      "Sharma Weddings' colour Ink #111111 will be removed.",
      "Sharma Weddings' colour Primary #E11D48 will change to Primary #BE123C.",
      "Sharma Weddings' colour Gold #D4AF37 will be added.",
      "Sharma Weddings' font Inter (headings) will change to Inter.",
    ]);
  });

  it("names a new order once, and nothing else when only the order moved", () => {
    const after = { ...before, colors: moveRow(before.colors, 1, -1) };
    expect(brandChanges(WHOSE, before, after)).toEqual([
      "Sharma Weddings' colours will be put in a new order.",
    ]);
  });

  it("the action's schema refuses a half-typed hex and a nameless row, by row", () => {
    const parsed = updateBrandSchema.safeParse({
      clientId: "00000000-0000-4000-8000-000000000001",
      colors: [{ name: "", hex: "#E1" }],
      fonts: [{ family: "", usage: "" }],
    });
    expect(parsed.success).toBe(false);
    const paths = parsed.error?.issues.map((issue) => issue.path.join(".")).sort();
    expect(paths).toEqual(["colors.0.hex", "colors.0.name", "fonts.0.family"]);
  });
});
