import { describe, expect, it } from "vitest";

import { isListKey, LIST_KEYS, LIST_LABELS } from "./registry";
import { listItemInputSchema, listItemUpdatePatch, nextPosition } from "./schemas";

describe("registry", () => {
  it("knows the job title list and labels every key", () => {
    expect(LIST_KEYS).toContain("job_title");
    for (const key of LIST_KEYS) expect(LIST_LABELS[key].plural).toBeTruthy();
    expect(isListKey("job_title")).toBe(true);
    expect(isListKey("task_type")).toBe(false);
  });
});

describe("listItemInputSchema", () => {
  it("trims the name and refuses an empty or overlong one", () => {
    expect(listItemInputSchema.parse({ name: "  Colorist " }).name).toBe("Colorist");
    expect(listItemInputSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(listItemInputSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });

  it("accepts only a six-digit hex colour", () => {
    expect(listItemInputSchema.safeParse({ name: "A", color: "#AD5009" }).success).toBe(true);
    expect(listItemInputSchema.safeParse({ name: "A", color: "red" }).success).toBe(false);
  });
});

describe("nextPosition", () => {
  it("starts at a0 and counts through digits then letters", () => {
    expect(nextPosition(null)).toBe("a0");
    expect(nextPosition("a0")).toBe("a1");
    expect(nextPosition("a9")).toBe("aa");
    expect(nextPosition("az")).toBe("b0");
    expect(nextPosition("zz")).toBe("zz0");
    expect(nextPosition("zz0")).toBe("zz1");
    expect(nextPosition("zzz")).toBe("zzz0");
  });

  it("always sorts after the key it follows", () => {
    let key: string | null = null;
    const seen: string[] = [];
    for (let i = 0; i < 1500; i += 1) {
      const next: string = nextPosition(key);
      if (key !== null) expect(next > key, `${next} > ${key}`).toBe(true);
      seen.push(next);
      key = next;
    }
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("listItemUpdatePatch", () => {
  it("writes only the columns the edit names, so a rename keeps the other fields", () => {
    expect(listItemUpdatePatch({ name: "Editor" })).toEqual({ name: "Editor" });
    expect(listItemUpdatePatch({ name: "Editor", color: "#AD5009" })).toEqual({
      name: "Editor",
      color: "#AD5009",
    });
    expect(listItemUpdatePatch({ name: "Editor", description: "", icon: "film" })).toEqual({
      name: "Editor",
      description: "",
      icon: "film",
    });
  });
});
