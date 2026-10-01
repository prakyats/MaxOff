import { beforeEach, describe, expect, it, vi } from "vitest";

const { claim, list, send } = vi.hoisted(() => ({ claim: vi.fn(), list: vi.fn(), send: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/core/auth/server", () => ({
  getCurrentMember: async () => ({ id: "m1", name: "Asha Rao" }),
}));
vi.mock("./env", () => ({
  pushEnvOrWarn: () => ({
    mode: "on",
    publicKey: "public",
    privateKey: "private",
    subject: "mailto:o@example.com",
  }),
  pushLoopbackAllowed: () => false,
}));
vi.mock("./push/send", () => ({ sendWebPush: send }));
vi.mock("./push/subscriptions", () => ({
  listOwnPushSubscriptions: list,
  rpcPushTestClaim: claim,
  rpcPushSubscriptionRemove: vi.fn(),
  rpcPushSubscriptionUpsert: vi.fn(),
}));

import { sendTestPush } from "./actions";

const device = {
  id: "s1",
  endpoint: "https://push.example/phone",
  p256dh: "k",
  auth: "a",
  disabledReason: null,
};

describe("sendTestPush: one test per 30 seconds (5A review S2)", () => {
  beforeEach(() => {
    claim.mockReset();
    list.mockReset().mockResolvedValue([device]);
    send.mockReset().mockResolvedValue({ outcome: "sent", status: 201, detail: null });
  });

  it("claims the test in the database before anything is sent", async () => {
    const order: string[] = [];
    claim.mockImplementation(async () => {
      order.push("claim");
      return 1;
    });
    send.mockImplementation(async () => {
      order.push("send");
      return { outcome: "sent", status: 201, detail: null };
    });
    const result = await sendTestPush();
    expect(result).toEqual({ ok: true, data: { accepted: 1, devices: 1, pushOff: false } });
    expect(order).toEqual(["claim", "send"]);
  });

  it("a second tap inside the window is refused with the friendly message, and sends nothing", async () => {
    claim.mockRejectedValue({
      code: "P0001",
      message: "RATE_LIMITED",
      details: "A test was sent a moment ago. Try again in half a minute.",
    });
    const result = await sendTestPush();
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "RATE_LIMITED",
        message: "A test was sent a moment ago. Try again in half a minute.",
      },
    });
    expect(send).not.toHaveBeenCalled();
  });
});
