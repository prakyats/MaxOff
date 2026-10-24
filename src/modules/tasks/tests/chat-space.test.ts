import { describe, expect, it } from "vitest";

import {
  barStuck,
  chatSpace,
  type ChatSpaceInput,
  enlargedLine,
  enlargedTitle,
  notedLine,
} from "../domain/chat-space";

/** A 1280 × 800 laptop: the panel starts 300 px down; stuck, 56 + 60 + 16 = 132 px down. */
const LAPTOP: ChatSpaceInput = {
  viewport: 800,
  panelTop: 300,
  stuckTop: 132,
  bands: 0,
  foot: 24,
  min: 320,
};

describe("chatSpace: the laptop chat fills to the screen's foot (task chat height)", () => {
  it("on opening, the panel runs from where it starts to the foot; the page keeps room for it stuck", () => {
    expect(chatSpace(LAPTOP)).toEqual({ panel: 476, reserve: 644 });
  });

  it("grows as the page scrolls and the header goes, up to the stuck height, never past it", () => {
    expect(chatSpace({ ...LAPTOP, panelTop: 200 })).toEqual({ panel: 576, reserve: 644 });
    expect(chatSpace({ ...LAPTOP, panelTop: 132 })).toEqual({ panel: 644, reserve: 644 });
    // A rounding past the stuck line never makes it taller than the room kept.
    expect(chatSpace({ ...LAPTOP, panelTop: 120 })).toEqual({ panel: 644, reserve: 644 });
  });

  it("the bands at the foot take their height off both", () => {
    expect(chatSpace({ ...LAPTOP, bands: 40 })).toEqual({ panel: 436, reserve: 604 });
  });

  it("a short screen keeps the panel at its minimum, and the page scrolls instead", () => {
    expect(chatSpace({ ...LAPTOP, viewport: 500 })).toEqual({ panel: 320, reserve: 344 });
    expect(chatSpace({ ...LAPTOP, viewport: 400 })).toEqual({ panel: 320, reserve: 320 });
  });

  it("whole pixels, rounded down, so the foot never spills past the screen", () => {
    expect(chatSpace({ ...LAPTOP, panelTop: 300.6 }).panel).toBe(475);
  });
});

describe("barStuck: the Work | Chat bar sticks once the header has scrolled away", () => {
  it("never on opening, at the top of the page", () => {
    expect(barStuck(56, 56, 0)).toBe(false);
  });

  it("stuck at the top bar's foot once the page has scrolled, with half a pixel of rounding", () => {
    expect(barStuck(56, 56, 240)).toBe(true);
    expect(barStuck(56.4, 56, 240)).toBe(true);
  });

  it("not while the header is still above it", () => {
    expect(barStuck(120, 56, 40)).toBe(false);
  });
});

describe("the chat's lines", () => {
  const you = { name: "You", noted: true, self: true };
  const asha = { name: "Asha Kumar", noted: true, self: false };
  const ravi = { name: "Ravi", noted: false, self: false };

  it("notedLine: the People card's key line in the chat head", () => {
    expect(notedLine([])).toBeNull();
    expect(notedLine([asha])).toBe("Noted");
    expect(notedLine([ravi])).toBe("Not noted");
    expect(notedLine([asha, you])).toBe("All noted");
    expect(notedLine([asha, ravi, you])).toBe("2 of 3 noted");
  });

  it("enlargedTitle: the task and the others on it by first name", () => {
    expect(enlargedTitle("Edit", [asha, you])).toBe("Edit · chat with Asha");
    expect(enlargedTitle("Edit", [asha, ravi])).toBe("Edit · chat with Asha, Ravi");
    expect(enlargedTitle("Edit", [you])).toBe("Edit · Chat");
    expect(enlargedTitle("Edit", [])).toBe("Edit · Chat");
    const many = ["A", "B", "C", "D", "E"].map((name) => ({ name, noted: false, self: false }));
    expect(enlargedTitle("Edit", many)).toBe("Edit · chat with A, B, C +2");
  });

  it("enlargedLine: the state and the deadline relative to now, capitalised", () => {
    expect(enlargedLine("In progress", "overdue 4 days")).toBe("In progress · Overdue 4 days");
    expect(enlargedLine("Not started", "in 2 days")).toBe("Not started · In 2 days");
    expect(enlargedLine("Completed", null)).toBe("Completed");
  });
});
