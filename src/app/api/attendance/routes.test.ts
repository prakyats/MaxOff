import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentMember, readReviewWeek, readLateRule, getCompBalance, compBalanceWords } =
  vi.hoisted(() => ({
    getCurrentMember: vi.fn(),
    readReviewWeek: vi.fn(),
    readLateRule: vi.fn(),
    getCompBalance: vi.fn(),
    compBalanceWords: vi.fn(),
  }));

vi.mock("server-only", () => ({}));
vi.mock("@/core/auth/server", () => ({ getCurrentMember }));
vi.mock("@/core/observability/capture", () => ({ captureException: () => "event-1" }));
// The module's own checks (zod, attendance.decide) are readReviewWeek's.
vi.mock("@/modules/attendance", () => ({ readReviewWeek, readLateRule }));
// The words are `modules/leave/tests/credits.test.ts`'s.
vi.mock("@/modules/leave", () => ({ getCompBalance, compBalanceWords }));

import { AppError } from "@/core/errors";

import { GET as lateRuleGET } from "./late-rule/route";
import { GET } from "./review-context/route";

const ORIGIN = "https://app.example";
const DAY = "00000000-0000-4000-8000-000000000001";

/** The attendance Review panel's context (B4). */
describe("GET /api/attendance/review-context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentMember.mockResolvedValue({ id: "owner" });
    readReviewWeek.mockResolvedValue({ memberId: "m1", week: [] });
    getCompBalance.mockResolvedValue({ availableDays: 1, useBy: "2026-10-30" });
    compBalanceWords.mockReturnValue("1 day · use by 30 Oct");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("answers the person's week and their comp leave", async () => {
    const response = await GET(new Request(`${ORIGIN}/api/attendance/review-context?day=${DAY}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { week: [], compLeave: "1 day · use by 30 Oct" },
    });
    expect(readReviewWeek).toHaveBeenCalledWith({ dayId: DAY });
    expect(getCompBalance).toHaveBeenCalledWith("m1");
    expect(compBalanceWords).toHaveBeenCalledWith({ availableDays: 1, useBy: "2026-10-30" });
  });

  it("refuses a signed-out caller, and keeps the read's refusal (no balance read)", async () => {
    getCurrentMember.mockResolvedValueOnce(null);
    expect((await GET(new Request(`${ORIGIN}/api/attendance/review-context`))).status).toBe(401);
    readReviewWeek.mockRejectedValueOnce(new AppError("FORBIDDEN"));
    expect((await GET(new Request(`${ORIGIN}/api/attendance/review-context`))).status).toBe(403);
    expect(getCompBalance).not.toHaveBeenCalled();
  });
});

/** The Start-day prompt's Late rule (v1.9 W4). */
describe("GET /api/attendance/late-rule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentMember.mockResolvedValue({ id: "crew" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("answers today's rule, or null with none", async () => {
    const rule = {
      startAt: "2026-11-02T04:30:00Z",
      lateAfter: "2026-11-02T04:45:00Z",
      suggestion: null,
    };
    readLateRule.mockResolvedValueOnce(rule);
    const response = await lateRuleGET(new Request(`${ORIGIN}/api/attendance/late-rule`));
    expect(await response.json()).toEqual({ ok: true, data: rule });
    readLateRule.mockResolvedValueOnce(null);
    const none = await lateRuleGET(new Request(`${ORIGIN}/api/attendance/late-rule`));
    expect(await none.json()).toEqual({ ok: true, data: null });
  });

  it("refuses a signed-out caller and keeps the read's refusal", async () => {
    getCurrentMember.mockResolvedValueOnce(null);
    expect((await lateRuleGET(new Request(`${ORIGIN}/api/attendance/late-rule`))).status).toBe(401);
    readLateRule.mockRejectedValueOnce(new AppError("FORBIDDEN"));
    expect((await lateRuleGET(new Request(`${ORIGIN}/api/attendance/late-rule`))).status).toBe(403);
  });
});
