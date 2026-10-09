import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  getCurrentMember: vi.fn(),
  readProjectActivity: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/core/auth/server", () => ({ getCurrentMember: reads.getCurrentMember }));
vi.mock("@/core/observability/capture", () => ({ captureException: () => "event-1" }));
// The read's own checks (zod, projects.manage, RLS) are the module's and pgTAP 73's.
vi.mock("@/modules/client-work", () => ({ readProjectActivity: reads.readProjectActivity }));

import { AppError } from "@/core/errors";

import { GET } from "./route";

const URL = "https://app.example/api/client-work/activity";

/** The project page's Activity panel: one page per call (the owner's preview feedback). */
describe("GET /api/client-work/activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reads.getCurrentMember.mockResolvedValue({ id: "admin" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("hands the project, the chip, the item and the cursor to the read", async () => {
    reads.readProjectActivity.mockResolvedValue({ lines: [], next: null });
    const response = await GET(
      new Request(`${URL}?project=p1&kind=items&item=i1&beforeAt=2026-10-09T00:00:00Z&beforeId=7`),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { lines: [], next: null } });
    expect(reads.readProjectActivity).toHaveBeenCalledWith({
      projectId: "p1",
      kind: "items",
      itemId: "i1",
      beforeAt: "2026-10-09T00:00:00Z",
      beforeId: "7",
    });
  });

  it("refuses a signed-out caller; the read's refusals keep their code", async () => {
    reads.getCurrentMember.mockResolvedValueOnce(null);
    expect((await GET(new Request(`${URL}?project=p1`))).status).toBe(401);
    expect(reads.readProjectActivity).not.toHaveBeenCalled();
    reads.readProjectActivity.mockRejectedValueOnce(new AppError("FORBIDDEN"));
    expect((await GET(new Request(`${URL}?project=p1`))).status).toBe(403);
    expect(reads.readProjectActivity).toHaveBeenLastCalledWith({
      projectId: "p1",
      kind: undefined,
      itemId: null,
      beforeAt: null,
      beforeId: null,
    });
  });
});
