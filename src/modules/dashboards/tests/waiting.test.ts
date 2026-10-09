import { describe, expect, it } from "vitest";

import { reachedAt, waitingFor } from "../domain/waiting";

const NOW = new Date("2026-10-09T06:30:00.000Z"); // 12:00 IST

/** The instant `hours` before NOW. */
const before = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

describe("waitingFor: how long a decision has waited for the Owner", () => {
  it("says hours under a day, muted", () => {
    expect(waitingFor(before(3), NOW)).toEqual({ label: "Waiting 3 h", tone: "muted" });
    expect(waitingFor(before(3.9), NOW)).toEqual({ label: "Waiting 3 h", tone: "muted" });
    expect(waitingFor(before(23.99), NOW)).toEqual({ label: "Waiting 23 h", tone: "muted" });
  });

  it("says under 1 h for a fresh item, and never a negative time", () => {
    expect(waitingFor(before(0.25), NOW)).toEqual({ label: "Waiting under 1 h", tone: "muted" });
    expect(waitingFor(NOW.toISOString(), NOW)).toEqual({
      label: "Waiting under 1 h",
      tone: "muted",
    });
    // A clock a little ahead of the server's: counted as now.
    expect(waitingFor(before(-2), NOW)).toEqual({ label: "Waiting under 1 h", tone: "muted" });
  });

  it("turns amber from one day, in whole days", () => {
    expect(waitingFor(before(24), NOW)).toEqual({ label: "Waiting 1 day", tone: "attention" });
    expect(waitingFor(before(47), NOW)).toEqual({ label: "Waiting 1 day", tone: "attention" });
    expect(waitingFor(before(48), NOW)).toEqual({ label: "Waiting 2 days", tone: "attention" });
    expect(waitingFor(before(71.9), NOW)).toEqual({ label: "Waiting 2 days", tone: "attention" });
  });

  it("turns red from three days", () => {
    expect(waitingFor(before(72), NOW)).toEqual({ label: "Waiting 3 days", tone: "danger" });
    expect(waitingFor(before(4 * 24 + 5), NOW)).toEqual({
      label: "Waiting 4 days",
      tone: "danger",
    });
  });

  it("counts elapsed time, not IST calendar days", () => {
    // Sent at 23:30 IST yesterday, read at 12:00 IST: 12.5 hours, not "1 day".
    expect(waitingFor("2026-10-08T18:00:00.000Z", NOW)).toEqual({
      label: "Waiting 12 h",
      tone: "muted",
    });
  });
});

describe("reachedAt: when an item reached the Owner", () => {
  it("is the latest moment given", () => {
    // A task handed in, then approved by its Admin: it reached the Owner at the Admin's approval.
    expect(reachedAt("2026-10-05T07:38:00.000Z", "2026-10-06T04:00:00.000Z")).toBe(
      "2026-10-06T04:00:00.000Z",
    );
    // An older Admin approval (of an earlier version) never beats the latest hand-in.
    expect(reachedAt("2026-10-07T04:00:00.000Z", "2026-10-06T04:00:00.000Z")).toBe(
      "2026-10-07T04:00:00.000Z",
    );
  });

  it("skips what is not known, and is null when nothing is", () => {
    expect(reachedAt("2026-10-05T07:38:00.000Z", null)).toBe("2026-10-05T07:38:00.000Z");
    expect(reachedAt(null, undefined, "2026-10-05T07:38:00.000Z")).toBe("2026-10-05T07:38:00.000Z");
    expect(reachedAt(null, undefined)).toBeNull();
    expect(reachedAt()).toBeNull();
  });

  it("compares instants, not their spelling", () => {
    expect(reachedAt("2026-10-06T09:00:00+05:30", "2026-10-06T04:00:00.000Z")).toBe(
      "2026-10-06T04:00:00.000Z",
    );
  });
});
