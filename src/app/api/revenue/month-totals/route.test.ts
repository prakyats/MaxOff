import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  getCurrentMember: vi.fn(),
  readTodayRevenue: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/core/auth/server", () => ({ getCurrentMember: reads.getCurrentMember }));
vi.mock("@/core/observability/capture", () => ({ captureException: () => "event-1" }));
// The read's own checks (finance.view, the function's gate) are the module's and pgTAP 148's.
vi.mock("@/modules/revenue", () => ({ readTodayRevenue: reads.readTodayRevenue }));

import { AppError } from "@/core/errors";

import { GET } from "./route";

const URL = "https://app.example/api/revenue/month-totals";
const TOTALS = {
  month: "2026-11-01",
  potential: 120000,
  achieved: 45000,
  remaining: 75000,
  notPriced: 2,
  noAmount: 1,
};

/** The Owner's Today line (v2.5 review): the month's totals, read on his tap, never cached. */
describe("GET /api/revenue/month-totals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reads.getCurrentMember.mockResolvedValue({ id: "owner" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("answers the Owner the month's totals, never cached", async () => {
    reads.readTodayRevenue.mockResolvedValue(TOTALS);
    const response = await GET(new Request(URL));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, data: TOTALS });
    expect(reads.readTodayRevenue).toHaveBeenCalledTimes(1);
  });

  it("refuses a signed-out caller before reading; an Admin or Crew is refused with 403 and no figure", async () => {
    reads.getCurrentMember.mockResolvedValueOnce(null);
    expect((await GET(new Request(URL))).status).toBe(401);
    expect(reads.readTodayRevenue).not.toHaveBeenCalled();
    reads.readTodayRevenue.mockRejectedValueOnce(new AppError("FORBIDDEN"));
    const refused = await GET(new Request(URL));
    expect(refused.status).toBe(403);
    expect(await refused.text()).not.toMatch(/₹|\d{4,}/);
  });
});
