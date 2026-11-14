import { beforeEach, describe, expect, it, vi } from "vitest";

type Early = Record<string, unknown>;

const fake = vi.hoisted(() => ({
  early: {} as Record<string, unknown>,
  rpcs: [] as string[],
  answer: { data: [] as unknown[], error: null as unknown },
}));

vi.mock("server-only", () => ({}));
// The shell's early read (`session_early()`, v2.0 X3): the part's pick, or the usual read when
// the pick says the part is not in the answer (`undefined`), as `readBeforeCheck` does.
vi.mock("@/core/auth/server", () => ({
  readBeforeCheck: async (
    pick: (early: Early) => { data: unknown; error: unknown } | undefined,
    read: (supabase: unknown) => PromiseLike<{ data: unknown; error: unknown }>,
  ) =>
    pick(fake.early) ??
    read({
      rpc: async (name: string) => {
        fake.rpcs.push(name);
        return fake.answer;
      },
    }),
}));
vi.mock("@/core/db/server", () => ({ createServerSupabase: vi.fn() }));

import { getOwnToday } from "../data/attendance";
import { getOwnHours } from "../data/hours";

const DAY = {
  work_date: "2026-11-11",
  attendance_started: true,
  is_working_day: true,
  day_id: null,
  state: null,
  yesterday_open_day_id: null,
  yesterday_started_at: null,
  covering_leave_type: null,
};

const HOURS = {
  work_date: "2026-11-11",
  rules_on: true,
  late_applies: true,
  early_applies: true,
  half: null,
  start_at: "2026-11-11T04:30:00Z",
  late_after: "2026-11-11T04:45:00Z",
  end_at: "2026-11-11T12:30:00Z",
  end_source: "work",
  stay_until: null,
  late_minutes: null,
  late_reason: null,
  late_reason_suggestion: null,
  early_leave_id: null,
  early_leave_state: null,
  early_leave_requested_at: null,
  early_leave_end_from: null,
  early_leave_reason: null,
  can_end_now: false,
};

/**
 * The own-day and own-hours picks out of `session_early()` (X5+ H4): the row, the refusal
 * `attendance_own_today()` would raise with its own code, a missing key read the usual way, and
 * no hours today.
 */
describe("the early read's own day and own hours", () => {
  beforeEach(() => {
    fake.early = {};
    fake.rpcs.length = 0;
    fake.answer = { data: [], error: null };
  });

  it("own day: the row from the early read, no read of its own", async () => {
    fake.early = { own_day: DAY, own_day_refused: null };
    expect((await getOwnToday()).workDate).toBe("2026-11-11");
    expect(fake.rpcs).toEqual([]);
  });

  it("own day refused: the early read's code (FORBIDDEN or UNAUTHENTICATED), never asked again", async () => {
    for (const code of ["FORBIDDEN", "UNAUTHENTICATED"]) {
      fake.early = { own_day: null, own_day_refused: code };
      await expect(getOwnToday()).rejects.toThrow(code);
    }
    // A refusal without its code is FORBIDDEN.
    fake.early = { own_day: null, own_day_refused: null };
    await expect(getOwnToday()).rejects.toThrow("FORBIDDEN");
    expect(fake.rpcs).toEqual([]);
  });

  it("own hours: the row from the early read", async () => {
    fake.early = { own_day: DAY, own_hours: HOURS };
    expect((await getOwnHours())?.endAt).toBe("2026-11-11T12:30:00Z");
    expect(fake.rpcs).toEqual([]);
  });

  it("own hours null: no hours today, not a read", async () => {
    fake.early = { own_day: DAY, own_hours: null };
    expect(await getOwnHours()).toBeNull();
    expect(fake.rpcs).toEqual([]);
  });

  it("own hours refused with the own day's code", async () => {
    for (const code of ["FORBIDDEN", "UNAUTHENTICATED"]) {
      fake.early = { own_day: null, own_day_refused: code, own_hours: null };
      await expect(getOwnHours()).rejects.toThrow(code);
    }
    expect(fake.rpcs).toEqual([]);
  });

  it("own hours missing from the answer (an older session_early): read the usual way", async () => {
    fake.early = { own_day: DAY };
    fake.answer = { data: [HOURS], error: null };
    expect((await getOwnHours())?.startAt).toBe("2026-11-11T04:30:00Z");
    expect(fake.rpcs).toEqual(["attendance_own_hours"]);
  });
});
