import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  getCurrentMember: vi.fn(),
  readBillingHistoryPage: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/core/auth/server", () => ({ getCurrentMember: reads.getCurrentMember }));
vi.mock("@/core/observability/capture", () => ({ captureException: () => "event-1" }));
// The read's own checks (zod, finance.view, the function's gate) are the module's and pgTAP 148's.
vi.mock("@/modules/revenue", () => ({ readBillingHistoryPage: reads.readBillingHistoryPage }));

import { AppError } from "@/core/errors";

import { GET } from "./route";

const URL = "https://app.example/api/revenue/billing-history";

/** The Billing section's history (v2.5, Q7): one page per call, the Owner's alone. */
describe("GET /api/revenue/billing-history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reads.getCurrentMember.mockResolvedValue({ id: "owner" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("hands the project, the page size and the kind of project to the read", async () => {
    reads.readBillingHistoryPage.mockResolvedValue({ rows: 0, entries: [] });
    const response = await GET(new Request(`${URL}?project=p1&limit=40&oneTime=1`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { rows: 0, entries: [] } });
    expect(reads.readBillingHistoryPage).toHaveBeenCalledWith({
      projectId: "p1",
      limit: "40",
      oneTime: "1",
    });
  });

  it("refuses a signed-out caller; an Admin's refusal keeps its code", async () => {
    reads.getCurrentMember.mockResolvedValueOnce(null);
    expect((await GET(new Request(`${URL}?project=p1`))).status).toBe(401);
    expect(reads.readBillingHistoryPage).not.toHaveBeenCalled();
    reads.readBillingHistoryPage.mockRejectedValueOnce(new AppError("FORBIDDEN"));
    expect((await GET(new Request(`${URL}?project=p1&limit=20&oneTime=0`))).status).toBe(403);
  });
});
