import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  attendanceStatus,
  STATUS_TONES,
  STATUS_TONES_LIST,
  statusLabel,
  statusTone,
} from "./status-badge";

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
    for (const s of ["rejected", "absent", "declined", "urgent"]) {
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
    // Owner correction 2026-10-21 (reverses C5): Cancelled is final, so red.
    expect(statusTone("cancelled")).toBe("danger");
    for (const s of ["draft", "todo", "inactive", "withdrawn", "none", "skipped"]) {
      expect(statusTone(s), s).toBe("neutral");
    }
  });

  it("follows the approved colour plan's chip table (owner 2026-10-21)", () => {
    // red: Overdue/Late, Cancelled, Rejected, Absent
    for (const s of ["cancelled", "rejected", "absent", "declined", "urgent"]) {
      expect(statusTone(s), s).toBe("danger");
    }
    // amber: Proposed, Waiting for you, Due soon, Nearly done
    for (const s of ["pending_review", "awaiting_choice", "admin_approved", "pending"]) {
      expect(statusTone(s), s).toBe("attention");
    }
    // blue: In progress, Open, Planned, Noted
    for (const s of ["in_progress", "open", "submitted"]) {
      expect(statusTone(s), s).toBe("info");
    }
    // green: Done, Approved, Present, Active
    for (const s of ["done", "completed", "approved", "present", "active"]) {
      expect(statusTone(s), s).toBe("success");
    }
    // grey: Draft, Archived, Withdrawn, Replaced, Not started
    for (const s of ["draft", "withdrawn", "superseded", "todo", "inactive"]) {
      expect(statusTone(s), s).toBe("neutral");
    }
  });

  it("keeps info (blue) for work in motion or open for work only", () => {
    const info = Object.entries(STATUS_TONES)
      .filter(([, tone]) => tone === "info")
      .map(([status]) => status)
      .sort();
    expect(info).toEqual(["converted", "in_progress", "open", "submitted"]);
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

    it(`${theme}: the calendar's leave text reads on its bar and its stripes (PP-calendar-3, 10)`, () => {
      for (const bg of ["leave-soft", "leave-stripe"]) {
        expect(tokens[bg], `--${bg} missing in ${selector}`).toBeDefined();
        const ratio = contrast(tokens["leave"] as string, tokens[bg] as string);
        expect(ratio, `${theme} leave on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    if (theme === "light") {
      it("light: the leave stripes read against their bar (PP-light-2)", () => {
        const ratio = contrast(tokens["leave-stripe"] as string, tokens["leave-soft"] as string);
        expect(ratio, `stripe on bar = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(1.25);
      });
    }

    it(`${theme}: today's box is a neutral surface step, apart from the weekly off, and its text reads (PP-calendar-15)`, () => {
      const bg = tokens["today"];
      expect(bg, `--today missing in ${selector}`).toBeDefined();
      // A surface step, not a red wash; and never the weekly off's muted tint.
      expect(bg).toBe(tokens["surface-3"]);
      expect(bg).not.toBe(tokens["muted"]);
      for (const text of ["foreground", "muted-foreground", "neutral", "holiday"]) {
        const ratio = contrast(tokens[text] as string, bg as string);
        expect(ratio, `${theme} ${text} on today = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
          4.5,
        );
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
      expect(
        contrast(
          tokens["destructive-solid-foreground"] as string,
          tokens["destructive-solid"] as string,
        ),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it(`${theme}: the page, the cards and the sidebar are three readable layers (V5b major change 4, FINAL 2)`, () => {
      // No pure white page; the page tint distinct from the cards; the sidebar one step off it.
      expect(tokens["background"]).not.toBe("#ffffff");
      expect(tokens["surface-0"]).toBe(tokens["background"]);
      expect(tokens["card"]).not.toBe(tokens["background"]);
      expect(tokens["sidebar"]).not.toBe(tokens["background"]);
      expect(tokens["sidebar"]).not.toBe(tokens["card"]);
      // The card's hairline is visible against the card (about 1.15:1 or more).
      const edge = contrast(tokens["border"] as string, tokens["card"] as string);
      expect(edge, `${theme} border on card = ${edge.toFixed(2)}`).toBeGreaterThanOrEqual(1.15);
      // Muted text reads on the quiet fills and in the sidebar too.
      for (const surface of ["muted", "sidebar", "sidebar-accent"]) {
        const ratio = contrast(tokens["muted-foreground"] as string, tokens[surface] as string);
        expect(
          ratio,
          `${theme} muted text on ${surface} = ${ratio.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      // The secondary outline is a 3:1 edge on the page, the card and the sidebar (WCAG 1.4.11).
      for (const surface of ["background", "card", "sidebar"]) {
        const ratio = contrast(tokens["control-border"] as string, tokens[surface] as string);
        expect(
          ratio,
          `${theme} control edge on ${surface} = ${ratio.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(3);
      }
    });

    it(`${theme}: the holiday green reads as text on the page and on every surface`, () => {
      for (const surface of ["background", "card", "surface-2", "surface-3"]) {
        const bg = tokens[surface] as string;
        expect(bg, `--${surface} missing in ${selector}`).toBeDefined();
        expect(contrast(tokens["holiday"] as string, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens["muted-foreground"] as string, bg)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${theme}: the Forest green approve commit is the same in both themes and reads (ADR-0015 amendment)`, () => {
      expect(tokens["approve"]).toBe("#15803d");
      expect(tokens["approve-foreground"]).toBe("#ffffff");
      const text = contrast(tokens["approve-foreground"] as string, tokens["approve"] as string);
      expect(text, `white on approve = ${text.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      // The button's edge against the page and the card it sits on (WCAG 1.4.11, 3:1).
      for (const surface of ["background", "card"]) {
        const edge = contrast(tokens["approve"] as string, tokens[surface] as string);
        expect(edge, `${theme} approve on ${surface} = ${edge.toFixed(2)}`).toBeGreaterThanOrEqual(
          3,
        );
      }
      expect(tokens["approve"]).not.toBe(tokens["danger"]);
      expect(tokens["approve"]).not.toBe(tokens["primary"]);
    });

    it(`${theme}: the commit is neutral and only the destructive commit is red (ADR-0015)`, () => {
      expect(tokens["primary"]).toBe(tokens["strong"]);
      expect(tokens["primary"]).not.toBe(tokens["danger"]);
      expect(tokens["destructive-solid"]).toBe("#c42126");
    });
  }
});

describe("attendanceStatus (B13: one colour per attendance status)", () => {
  it("colours an undecided day amber, whatever it proposes", () => {
    const proposed = attendanceStatus({ status: "absent", undecided: true });
    expect(proposed).toBe("pending_review");
    expect(statusTone(proposed)).toBe("attention");
    expect(attendanceStatus({ status: "leave", undecided: true })).toBe("pending_review");
  });

  it("colours a decided day by its outcome", () => {
    expect(statusTone(attendanceStatus({ status: "absent", undecided: false }))).toBe("danger");
    expect(statusTone(attendanceStatus({ status: "present", undecided: false }))).toBe("success");
    expect(attendanceStatus({ status: null, undecided: false })).toBe("awaiting_choice");
  });
});
