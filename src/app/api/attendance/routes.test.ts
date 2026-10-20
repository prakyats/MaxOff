import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentMember, readReviewWeek, getCompBalance, compBalanceWords } = vi.hoisted(() => ({
  getCurrentMember: vi.fn(),
  readReviewWeek: vi.fn(),
  getCompBalance: vi.fn(),
  compBalanceWords: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/core/auth/server", () => ({ getCurrentMember }));
vi.mock("@/core/observability/capture", () => ({ captureException: () => "event-1" }));
// The module's own checks (zod, attendance.decide) are readReviewWeek's.
vi.mock("@/modules/attendance", () => ({ readReviewWeek }));
// The words are `modules/leave/tests/credits.test.ts`'s.
vi.mock("@/modules/leave", () => ({ getCompBalance, compBalanceWords }));

import { AppError } from "@/core/errors";

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
