import { describe, expect, it } from "vitest";

import { clockWords, dayClockWords, dayKeyWords } from "./clock-words";
import { formatDateTime, formatTime, toISTDate } from "./ist";

const SAMPLES = [
  "2026-10-22T04:11:00.000Z",
  "2026-10-22T06:30:00.000Z",
  "2026-10-22T12:30:00.000Z",
  "2026-10-22T18:30:00.000Z",
  "2026-10-21T23:59:00.000Z",
  "2026-09-30T18:29:00.000Z",
];

describe("clockWords: the IST time of day without date-fns", () => {
  it("says what formatTime says, morning, noon, evening and midnight", () => {
    for (const iso of SAMPLES) expect(clockWords(new Date(iso))).toBe(formatTime(iso));
  });
});

describe("dayClockWords and dayKeyWords: the IST day without date-fns", () => {
  it("say what formatDateTime and toISTDate say, across IST midnight", () => {
    for (const iso of SAMPLES) {
      expect(dayClockWords(new Date(iso))).toBe(formatDateTime(iso));
      expect(dayKeyWords(new Date(iso))).toBe(toISTDate(iso));
    }
  });
});
