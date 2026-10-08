import { describe, expect, it } from "vitest";

import {
  appReportSchema,
  platformLabel,
  REACHABILITY_STATES,
  reachabilityReason,
  toReachabilityRows,
} from "./reachability";

describe("reachabilityReason (5.4)", () => {
  it("says why someone can't be reached, in plain words, for every state", () => {
    expect(reachabilityReason("no_subscription")).toBe("Notifications never turned on");
    expect(reachabilityReason("permission_revoked")).toBe("Notifications blocked on their phone");
    expect(reachabilityReason("ios_not_installed")).toBe("iPhone without MaxOff installed");
    expect(reachabilityReason("failing")).toBe("Notifications keep failing");
    expect(reachabilityReason("ok")).toBe("Reachable");
    for (const state of REACHABILITY_STATES) {
      expect(reachabilityReason(state)).not.toMatch(/_/);
    }
  });
});

describe("platformLabel", () => {
  it("names the device for the Owner, and nothing when none is known", () => {
    expect(platformLabel("android")).toBe("Android");
    expect(platformLabel("ios")).toBe("iPhone or iPad");
    expect(platformLabel("desktop")).toBe("Computer");
    expect(platformLabel("other")).toBe("Other device");
    expect(platformLabel(null)).toBeNull();
  });
});

describe("toReachabilityRows", () => {
  const row = {
    member_id: "m1",
    full_name: "Asha",
    role: "staff",
    state: "failing",
    since: "2026-10-01T00:00:00+00:00",
    platform: "android",
    last_success_at: null,
  };

  it("maps the function's rows", () => {
    expect(toReachabilityRows([row])).toEqual([
      {
        memberId: "m1",
        fullName: "Asha",
        state: "failing",
        platform: "android",
        lastSuccessAt: null,
      },
    ]);
  });

  it("drops a row it does not understand instead of showing it wrongly", () => {
    expect(toReachabilityRows([{ ...row, state: "asleep" }, null, row])).toHaveLength(1);
  });
});

describe("appReportSchema", () => {
  it("takes the four platforms and a boolean only", () => {
    expect(appReportSchema.safeParse({ platform: "ios", isStandalone: false }).success).toBe(true);
    expect(appReportSchema.safeParse({ platform: "symbian", isStandalone: false }).success).toBe(
      false,
    );
    expect(appReportSchema.safeParse({ platform: "ios", isStandalone: "yes" }).success).toBe(false);
  });
});
