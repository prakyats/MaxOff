import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { STATUS_TONES, STATUS_TONES_LIST, statusLabel, statusTone } from "./status-badge";

/** Every enum value in DATA-MODEL §0 that a badge can show. Keep in sync with the doc. */
const DATA_MODEL_STATES = {
  member_status: ["invited", "active", "deactivated"],
  attendance_choice: ["present", "leave", "half_day", "comp_leave"],
  day_status: ["present", "leave", "half_day", "comp_leave", "absent"],
  attendance_state: ["awaiting_choice", "pending_review", "approved", "corrected"],
  leave_type: ["leave", "half_day", "comp_leave"],
  leave_state: ["submitted", "approved", "rejected", "withdrawn", "superseded", "cancelled"],
  client_state: ["draft", "active", "paused", "inactive"],
  project_state: ["open", "in_progress", "completed", "cancelled"],
  cycle_state: ["open", "settled"],
  item_state: ["open", "done", "approved", "cancelled", "carried"],
  carry_decision: ["carry_forward", "close", "leave_pending"],
  task_state: [
    "todo",
    "in_progress",
    "submitted",
    "admin_approved",
    "changes_requested",
    "completed",
    "cancelled",
  ],
  admin_step: ["required", "none", "skipped"],
  priority: ["low", "medium", "high", "urgent"],
  review_decision: ["approved", "rejected"],
  request_state: ["pending", "converted", "declined", "withdrawn"],
  billing_status: ["not_billed", "billed"],
} as const;

describe("STATUS_TONES", () => {
  it("covers every workflow value in DATA-MODEL §0", () => {
    for (const [enumName, values] of Object.entries(DATA_MODEL_STATES)) {
      for (const value of values) {
        expect(STATUS_TONES, `${enumName}.${value}`).toHaveProperty(value);
      }
    }
  });

  it("has no tone for a value that isn't in DATA-MODEL §0", () => {
    const documented = new Set(
      (Object.values(DATA_MODEL_STATES) as readonly (readonly string[])[]).flat(),
    );
    for (const key of Object.keys(STATUS_TONES)) expect(documented.has(key), key).toBe(true);
  });

  it("uses only the six tones of ARCHITECTURE §3.3", () => {
    expect(STATUS_TONES_LIST).toEqual([
      "success",
      "info",
      "attention",
      "danger",
      "neutral",
      "brand",
    ]);
    for (const [status, tone] of Object.entries(STATUS_TONES)) {
      expect(STATUS_TONES_LIST, status).toContain(tone);
    }
  });

  it("follows the brand rules: red means act now, green means accepted", () => {
    for (const s of ["rejected", "absent", "cancelled", "declined", "urgent"]) {
      expect(statusTone(s), s).toBe("danger");
    }
    for (const s of ["approved", "completed", "done", "settled", "billed"]) {
      expect(statusTone(s), s).toBe("success");
    }
    for (const s of ["in_progress", "submitted", "converted"]) {
      expect(statusTone(s), s).toBe("info");
    }
    for (const s of ["pending_review", "awaiting_choice", "changes_requested", "admin_approved"]) {
      expect(statusTone(s), s).toBe("attention");
    }
    for (const s of ["draft", "todo", "inactive", "withdrawn", "none", "skipped"]) {
      expect(statusTone(s), s).toBe("neutral");
    }
  });

  it("keeps info (blue) for work in motion only", () => {
    const info = Object.entries(STATUS_TONES)
      .filter(([, tone]) => tone === "info")
      .map(([status]) => status)
      .sort();
    expect(info).toEqual(["converted", "in_progress", "submitted"]);
    for (const s of ["invited", "leave", "half_day", "comp_leave", "carry_forward", "corrected"]) {
      expect(statusTone(s), s).toBe("neutral");
    }
  });

  it("falls back to neutral for unknown values instead of throwing", () => {
    expect(statusTone("something_new")).toBe("neutral");
  });
});

describe("statusLabel", () => {
  it("turns snake_case into a sentence", () => {
    expect(statusLabel("in_progress")).toBe("In progress");
    expect(statusLabel("admin_approved")).toBe("Admin approved");
    expect(statusLabel("approved")).toBe("Approved");
  });

  it("uses the overrides for values a plain split would get wrong", () => {
    expect(statusLabel("todo")).toBe("To do");
    expect(statusLabel("comp_leave")).toBe("Comp leave");
  });
});

/* ---------- Contrast: every badge tone must read at 4.5:1 on its own background ---------- */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const ch = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrast(a: string, b: string): number {
  const la = luminance(hexToRgb(a));
  const lb = luminance(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Reads a CSS block (`:root { ... }` or `.dark { ... }`) into a var → hex map. */
function readTokens(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const end = css.indexOf("\n}", start);
  const block = css.slice(start, end);
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[match[1] as string] = match[2] as string;
  }
  return tokens;
}

const css = readFileSync(
  fileURLToPath(new URL("../../../app/globals.css", import.meta.url)),
  "utf8",
);

describe("badge contrast (globals.css)", () => {
  for (const [theme, selector] of [
    ["light", ":root"],
    ["dark", ".dark"],
  ] as const) {
    const tokens = readTokens(css, selector);

    it(`${theme}: every tone reads at 4.5:1 on its own soft background`, () => {
      for (const tone of STATUS_TONES_LIST) {
        const text = tokens[tone];
        const bg = tokens[`${tone}-soft`];
        expect(text, `--${tone} missing in ${selector}`).toBeDefined();
        expect(bg, `--${tone}-soft missing in ${selector}`).toBeDefined();
        const ratio = contrast(text as string, bg as string);
        expect(
          ratio,
          `${theme} ${tone}: ${text} on ${bg} = ${ratio.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${theme}: body and muted text read on the page and on surfaces`, () => {
      for (const surface of ["background", "card"]) {
        const bg = tokens[surface] as string;
        expect(contrast(tokens["foreground"] as string, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens["muted-foreground"] as string, bg)).toBeGreaterThanOrEqual(4.5);
      }
      expect(
        contrast(tokens["destructive-foreground"] as string, tokens["destructive"] as string),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(tokens["primary-foreground"] as string, tokens["primary"] as string),
      ).toBeGreaterThanOrEqual(4.5);
    });
  }
});
