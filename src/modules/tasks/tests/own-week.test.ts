import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ answer: {} as Record<string, unknown> }));

vi.mock("server-only", () => ({}));
vi.mock("@/core/db/server", () => ({
  createServerSupabase: async () => ({
    rpc: async () => ({ data: fake.answer, error: null }),
  }),
}));

import { listOwnWeek } from "../data/dashboards";

/** own_week()'s first two keys, as the function from before the folds answers. */
const FIRST = { holidays: [], events: [] };

describe("listOwnWeek (v2.0 X3: the /my-day and /tasks folds)", () => {
  beforeEach(() => {
    fake.answer = { ...FIRST };
  });

  it("carries the request count, the thresholds, the freelancers and the own leave", async () => {
    fake.answer = {
      ...FIRST,
      leave: [{ type: "leave", start_date: "2026-11-06", end_date: "2026-11-07" }],
      freelancers: ["f1"],
      requests_to_decide: 2,
      ack_escalate_hours: 4,
      ack_escalate_owner_hours: 8,
    };
    const week = await listOwnWeek("2026-11-05", "2026-11-11");
    expect(week.requestsToDecide).toBe(2);
    expect(week.escalation).toEqual({ ackEscalateHours: 4, ackEscalateOwnerHours: 8 });
    expect(week.freelancers).toEqual(["f1"]);
    expect(week.leave).toEqual([{ type: "leave", startDate: "2026-11-06", endDate: "2026-11-07" }]);
  });

  it("an older own_week without the keys: undefined and null, so the page reads them itself", async () => {
    const week = await listOwnWeek("2026-11-05", "2026-11-11");
    expect(week.requestsToDecide).toBeUndefined();
    expect(week.escalation).toBeNull();
    expect(week.freelancers).toBeUndefined();
    expect(week.leave).toBeUndefined();
  });

  it("no settings row visible (null thresholds): null, never a zero threshold", async () => {
    fake.answer = {
      ...FIRST,
      requests_to_decide: 0,
      ack_escalate_hours: null,
      ack_escalate_owner_hours: null,
    };
    const week = await listOwnWeek("2026-11-05", "2026-11-11");
    expect(week.requestsToDecide).toBe(0);
    expect(week.escalation).toBeNull();
  });
});
