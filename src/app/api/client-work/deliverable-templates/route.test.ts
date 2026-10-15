import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  getCurrentMember: vi.fn(),
  readDeliverableTemplateOptions: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/core/auth/server", () => ({ getCurrentMember: reads.getCurrentMember }));
vi.mock("@/core/observability/capture", () => ({ captureException: () => "event-1" }));
// The read's own checks (projects.manage, RLS) are the module's and pgTAP 78's.
vi.mock("@/modules/client-work", () => ({
  readDeliverableTemplateOptions: reads.readDeliverableTemplateOptions,
}));

import { AppError } from "@/core/errors";

import { GET } from "./route";

const URL = "https://app.example/api/client-work/deliverable-templates";

/** "+ Add deliverable" reads the deliverable templates as it opens (6b Release 2). */
describe("GET /api/client-work/deliverable-templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reads.getCurrentMember.mockResolvedValue({ id: "admin" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("answers the templates", async () => {
    const options = [{ id: "t1", name: "Item", stageGroups: [{ label: null, stages: ["One"] }] }];
    reads.readDeliverableTemplateOptions.mockResolvedValue(options);
    const response = await GET(new Request(URL));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: options });
  });

  it("refuses a signed-out caller; the read's refusals keep their code", async () => {
    reads.getCurrentMember.mockResolvedValueOnce(null);
    expect((await GET(new Request(URL))).status).toBe(401);
    expect(reads.readDeliverableTemplateOptions).not.toHaveBeenCalled();
    reads.readDeliverableTemplateOptions.mockRejectedValueOnce(new AppError("FORBIDDEN"));
    expect((await GET(new Request(URL))).status).toBe(403);
  });
});
