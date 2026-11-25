import { beforeEach, describe, expect, it, vi } from "vitest";

const { cronAuthorised, uploadWatchJob } = vi.hoisted(() => ({
  cronAuthorised: vi.fn(() => true),
  uploadWatchJob: vi.fn(),
}));

vi.mock("@/core/http/cron-auth", () => ({ cronAuthorised }));
vi.mock("@/core/observability/capture", () => ({ captureException: () => "event-1" }));
vi.mock("@/modules/uploads", () => ({ uploadWatchJob }));

import { POST } from "./route";

const request = () => new Request("https://app.example/api/cron/upload-watch", { method: "POST" });

describe("the upload_watch cron route (v4.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("refuses a caller without the cron secret and runs nothing", async () => {
    cronAuthorised.mockReturnValueOnce(false);
    expect((await POST(request())).status).toBe(401);
    expect(uploadWatchJob).not.toHaveBeenCalled();
  });

  it("answers the job's report", async () => {
    uploadWatchJob.mockResolvedValue({ due: 2, offsets: 1, received: 1 });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ job: "upload_watch", due: 2, received: 1 });
  });

  it("a failed run is a 500 with the Sentry event id only", async () => {
    uploadWatchJob.mockRejectedValue(new Error("boom"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "INTERNAL", eventId: "event-1" });
  });
});
