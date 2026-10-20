import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentMember, readReviewWeek, getCompBalance } = vi.hoisted(() => ({
  getCurrentMember: vi.fn(),
  readReviewWeek: vi.fn(),
  getCompBalance: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/core/auth/server", () => ({ getCurrentMember }));
vi.mock("@/core/observability/capture", () => ({ captureException: () => "event-1" }));
// The module's own checks (zod, attendance.decide) are readReviewWeek's.
vi.mock("@/modules/attendance", () => ({ readReviewWeek }));
vi.mock("@/modules/leave", async () => {
  const words = await import("@/modules/leave/domain/credits");
  return { getCompBalance, compBalanceWords: words.compBalanceWords };
});

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
  });

  it("refuses a signed-out caller, and keeps the read's refusal (no balance read)", async () => {
    getCurrentMember.mockResolvedValueOnce(null);
    expect((await GET(new Request(`${ORIGIN}/api/attendance/review-context`))).status).toBe(401);
    readReviewWeek.mockRejectedValueOnce(new AppError("FORBIDDEN"));
    expect((await GET(new Request(`${ORIGIN}/api/attendance/review-context`))).status).toBe(403);
    expect(getCompBalance).not.toHaveBeenCalled();
  });
});
