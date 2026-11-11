import { describe, expect, it } from "vitest";

import { dayHours, LAST_MINUTE } from "../e2e/working-hours-day";

/** Minutes since IST midnight for `HH:MM`. */
const at = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * X5 (owner via the advisor, #89, 11 Nov 2026): the working-hours e2e sets its day around the hour
 * it runs; these are its margins at the day's edges, which a run never has to wait for.
 */
describe("the working-hours spec's day, at the IST day's edges", () => {
  it("fails loudly outside 00:01-23:56 IST, naming the time", () => {
    expect(() => dayHours(at("00:00"), 40, 120)).toThrow(
      "working-hours fixture: outside the runnable window (00:00 IST)",
    );
    expect(() => dayHours(at("23:57"), 5, 30)).toThrow(
      "working-hours fixture: outside the runnable window (23:57 IST)",
    );
    expect(() => dayHours(at("23:59"), 5, 30)).toThrow(
      "working-hours fixture: outside the runnable window (23:59 IST)",
    );
  });

  it("has a late start from 00:01 IST: the grace stays inside the minutes the day has had", () => {
    for (const t of ["00:01", "00:05", "00:16", "11:00", "23:50", "23:56"]) {
      const { start, startedAgo, grace } = dayHours(at(t), 40, 120);
      expect(start, t).toBeGreaterThanOrEqual(0);
      expect(startedAgo, `${t}: past the grace`).toBeGreaterThan(grace);
      expect(grace, t).toBeGreaterThanOrEqual(0);
      expect(grace, t).toBeLessThanOrEqual(15);
    }
    // 00:05: the day began at midnight, no grace left, five minutes late.
    expect(dayHours(at("00:05"), 40, 120)).toMatchObject({ start: 0, startedAgo: 5, grace: 4 });
    // By day the margins are the spec's own: 40 minutes ago, the usual 15-minute grace.
    expect(dayHours(at("11:00"), 40, 120)).toMatchObject({ startedAgo: 40, grace: 15 });
  });

  it("keeps a start within the grace for a day that is not late", () => {
    for (const t of ["00:01", "00:05", "23:50"]) {
      const { startedAgo, grace } = dayHours(at(t), 5, 120);
      expect(startedAgo, t).toBeLessThanOrEqual(grace);
    }
  });

  it("ends whole minutes away, with a minute left after it for a Stay until", () => {
    for (const t of ["00:01", "00:05", "11:00", "21:30", "23:50", "23:56"]) {
      for (const endIn of [30, 120, 480]) {
        const now = at(t);
        const { end } = dayHours(now, 5, endIn);
        expect(end - now, `${t} +${endIn}`).toBeGreaterThanOrEqual(2);
        expect(LAST_MINUTE - end, `${t} +${endIn}`).toBeGreaterThanOrEqual(1);
      }
    }
    // By day the end is the one asked for.
    expect(dayHours(at("11:00"), 5, 120).end).toBe(at("13:00"));
    // 23:50: nine minutes left, the end at 23:54, Stay until up to 23:59.
    expect(dayHours(at("23:50"), 5, 30).end).toBe(at("23:54"));
  });
});
