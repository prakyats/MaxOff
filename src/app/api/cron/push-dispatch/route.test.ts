import { beforeEach, describe, expect, it, vi } from "vitest";

const { dispatchPush, dispatchEmail } = vi.hoisted(() => ({
  dispatchPush: vi.fn(),
  dispatchEmail: vi.fn(),
}));

vi.mock("@/core/http/cron-auth", () => ({ cronAuthorised: () => true }));
vi.mock("@/core/notifications/push/dispatch", () => ({ dispatchPush, dispatchEmail }));
vi.mock("@/core/observability/capture", () => ({ captureException: () => "event-1" }));

import { POST } from "./route";

describe("the push_dispatch cron route (5A review M1)", () => {
  beforeEach(() => {
    dispatchPush.mockReset();
    dispatchEmail.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("runs the email pass even when the push pass throws, and reports both", async () => {
    dispatchPush.mockRejectedValue(new Error("push_claim failed"));
    dispatchEmail.mockResolvedValue({ claimed: 2, sent: 2 });
    const response = await POST(new Request("https://app.example/api/cron/push-dispatch"));
    expect(dispatchEmail).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      job: "push_dispatch",
      error: "INTERNAL",
      eventId: "event-1",
      email: { claimed: 2, sent: 2 },
    });
  });

  it("push and email both run on a good minute", async () => {
    dispatchPush.mockResolvedValue({ claimed: 1, sent: 1 });
    dispatchEmail.mockResolvedValue({ claimed: 0 });
    const response = await POST(new Request("https://app.example/api/cron/push-dispatch"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      job: "push_dispatch",
      sent: 1,
      email: { claimed: 0 },
    });
  });
});
