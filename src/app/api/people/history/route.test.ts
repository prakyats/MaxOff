import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  getCurrentMember: vi.fn(),
  readPersonHistory: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/core/auth/server", () => ({ getCurrentMember: reads.getCurrentMember }));
vi.mock("@/core/observability/capture", () => ({ captureException: () => "event-1" }));
vi.mock("./read", () => ({ readPersonHistory: reads.readPersonHistory }));

import { AppError } from "@/core/errors";

import { GET } from "./route";

const URL = "https://app.example/api/people/history";

/** The person page's History sheet: read when it opens, never with the layout (P2 item 6). */
describe("GET /api/people/history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reads.getCurrentMember.mockResolvedValue({ id: "owner" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("hands the person to the read and answers its lines", async () => {
    reads.readPersonHistory.mockResolvedValue({ lines: [], limitedTo: null });
    const response = await GET(new Request(`${URL}?member=m1`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { lines: [], limitedTo: null } });
    expect(reads.readPersonHistory).toHaveBeenCalledWith({ memberId: "m1" });
  });

  it("refuses a signed-out caller; the read's refusals keep their code", async () => {
    reads.getCurrentMember.mockResolvedValueOnce(null);
    expect((await GET(new Request(`${URL}?member=m1`))).status).toBe(401);
    expect(reads.readPersonHistory).not.toHaveBeenCalled();
    reads.readPersonHistory.mockRejectedValueOnce(new AppError("FORBIDDEN"));
    expect((await GET(new Request(`${URL}?member=m1`))).status).toBe(403);
    reads.readPersonHistory.mockRejectedValueOnce(new AppError("NOT_FOUND"));
    expect((await GET(new Request(`${URL}?member=m1`))).status).toBe(404);
  });
});
