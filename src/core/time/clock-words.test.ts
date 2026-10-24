import { describe, expect, it } from "vitest";

import { clockWords } from "./clock-words";
import { formatTime } from "./ist";

describe("clockWords: the IST time of day without date-fns", () => {
  it("says what formatTime says, morning, noon, evening and midnight", () => {
    for (const iso of [
      "2026-10-22T04:11:00.000Z",
      "2026-10-22T06:30:00.000Z",
      "2026-10-22T12:30:00.000Z",
      "2026-10-22T18:30:00.000Z",
      "2026-10-21T23:59:00.000Z",
    ]) {
      expect(clockWords(new Date(iso))).toBe(formatTime(iso));
    }
  });
});
