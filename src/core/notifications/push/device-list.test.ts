import { describe, expect, it } from "vitest";

import { deliveryLine, type DeviceSource, deviceRowsOf, problemLine } from "./device-list";

const NOW = new Date("2026-10-03T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("deliveryLine (5.5)", () => {
  it("no delivery yet", () => {
    expect(deliveryLine(null, NOW)).toBe("No notification yet");
  });
  it("relative times", () => {
    expect(deliveryLine(ago(20_000), NOW)).toBe("Last notification just now");
    expect(deliveryLine(ago(5 * MIN), NOW)).toBe("Last notification 5 min ago");
    expect(deliveryLine(ago(2 * HOUR + 10 * MIN), NOW)).toBe("Last notification 2 h ago");
    expect(deliveryLine(ago(DAY + HOUR), NOW)).toBe("Last notification 1 day ago");
    expect(deliveryLine(ago(3 * DAY), NOW)).toBe("Last notification 3 days ago");
  });
  it("a week or more: the IST date", () => {
    expect(deliveryLine("2026-09-20T20:00:00Z", NOW)).toBe("Last notification on 21 Sep");
  });
  it("a clock a little ahead never says the future", () => {
    expect(deliveryLine(ago(-5000), NOW)).toBe("Last notification just now");
  });
});

describe("problemLine: why a device stopped, in plain words", () => {
  it("each reason", () => {
    expect(problemLine({ disabledReason: "gone", failureCount: 0 })).toBe(
      "Notifications were turned off on this device",
    );
    expect(problemLine({ disabledReason: "expired", failureCount: 5 })).toBe(
      "Stopped after repeated failures",
    );
    expect(problemLine({ disabledReason: "signed_out", failureCount: 0 })).toBe(
      "Signed out of this device",
    );
    expect(problemLine({ disabledReason: "deactivated", failureCount: 0 })).toBe(
      "Stopped when the account was deactivated",
    );
  });
  it("an active device: nothing, unless it keeps failing (two in a row, as 5.4)", () => {
    expect(problemLine({ disabledReason: null, failureCount: 0 })).toBeNull();
    expect(problemLine({ disabledReason: null, failureCount: 1 })).toBeNull();
    expect(problemLine({ disabledReason: null, failureCount: 2 })).toBe(
      "Notifications keep failing on this device",
    );
  });
});

const source = (overrides: Partial<DeviceSource>): DeviceSource => ({
  id: "id",
  endpoint: "https://push.example/x",
  userAgent: null,
  label: null,
  platform: "android",
  isStandalone: false,
  createdAt: "2026-10-01T00:00:00Z",
  lastSuccessAt: null,
  failureCount: 0,
  disabledReason: null,
  ...overrides,
});

describe("deviceRowsOf", () => {
  it("working devices first, latest delivery first; the stopped last; never an endpoint in the words", () => {
    const rows = deviceRowsOf(
      [
        source({ id: "gone", disabledReason: "gone", lastSuccessAt: ago(HOUR) }),
        source({
          id: "laptop",
          platform: "desktop",
          userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0",
          lastSuccessAt: ago(3 * DAY),
        }),
        source({
          id: "phone",
          userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36",
          isStandalone: true,
          lastSuccessAt: ago(2 * HOUR),
        }),
      ],
      NOW,
    );
    expect(rows.map((row) => row.id)).toEqual(["phone", "laptop", "gone"]);
    expect(rows[0]).toMatchObject({
      name: "Chrome on Android",
      detail: "Android · installed app",
      delivery: "Last notification 2 h ago",
      problem: null,
      active: true,
    });
    expect(rows[1]).toMatchObject({ name: "Edge on Windows", detail: "Computer · browser" });
    expect(rows[2]).toMatchObject({
      problem: "Notifications were turned off on this device",
      active: false,
    });
    for (const row of rows) {
      for (const words of [row.name, row.detail, row.delivery, row.problem ?? ""]) {
        expect(words).not.toContain("push.example");
        expect(words).not.toContain(row.id);
      }
    }
  });

  it("a device removed from the list is not listed again (its row is kept, owner 2026-10-06)", () => {
    const rows = deviceRowsOf(
      [
        source({ id: "here", lastSuccessAt: ago(HOUR) }),
        source({ id: "removed", disabledReason: "removed", lastSuccessAt: ago(2 * HOUR) }),
      ],
      NOW,
    );
    expect(rows.map((row) => row.id)).toEqual(["here"]);
    expect(deviceRowsOf([source({ id: "removed", disabledReason: "removed" })], NOW)).toEqual([]);
  });
});
