import { describe, expect, it, vi } from "vitest";

import { parsePeopleGroup } from "@/modules/dashboards";

import { showsYesterday, yesterdayLine } from "./yesterday";

// The barrel carries the module's reads; only its pure `parsePeopleGroup` runs here.
vi.mock("server-only", () => ({}));

describe("the board's line about yesterday (decision 24 as amended; its skeleton draws it too)", () => {
  it("shows on End not recorded only, read as the page reads the group", () => {
    const cases: (string | string[] | undefined)[] = [
      "end_not_recorded",
      ["end_not_recorded", "present"],
      ["present", "end_not_recorded"],
      "present",
      "nonsense",
      [],
      undefined,
    ];
    for (const group of cases) {
      expect(showsYesterday(group), String(group)).toBe(
        parsePeopleGroup(group) === "end_not_recorded",
      );
    }
    expect(showsYesterday(null)).toBe(false);
  });

  it("names yesterday in IST", () => {
    expect(yesterdayLine("2026-10-08")).toBe(
      "Yesterday, Wed 7 Oct: started, End day not recorded, not decided yet.",
    );
    expect(yesterdayLine("2026-10-01")).toBe(
      "Yesterday, Wed 30 Sep: started, End day not recorded, not decided yet.",
    );
  });
});
