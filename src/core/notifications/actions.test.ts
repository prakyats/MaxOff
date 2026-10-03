import { beforeEach, describe, expect, it, vi } from "vitest";

const { claim, list, send, record, removeOwn, finish } = vi.hoisted(() => ({
  claim: vi.fn(),
  list: vi.fn(),
  send: vi.fn(),
  record: vi.fn(),
  removeOwn: vi.fn(),
  finish: vi.fn(),
}));

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
  rpcPushSubscriptionRemoveOwn: removeOwn,
  rpcPushSubscriptionUpsert: vi.fn(),
  recordTestDelivered: record,
}));
vi.mock("./onboarding", () => ({ rpcOnboardingFinish: finish }));

import { finishOnboarding, removeDevice, sendTestPush } from "./actions";

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
    record.mockReset();
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

describe("sendTestPush records what the push service accepted (5.5)", () => {
  beforeEach(() => {
    claim.mockReset().mockResolvedValue(2);
    record.mockReset();
    list
      .mockReset()
      .mockResolvedValue([device, { ...device, id: "s2", endpoint: "https://push.example/old" }]);
  });

  it("only the accepted devices count as delivered to", async () => {
    send
      .mockReset()
      .mockResolvedValueOnce({ outcome: "sent", status: 201, detail: null })
      .mockResolvedValueOnce({ outcome: "error", status: 500, detail: "http_500" });
    const result = await sendTestPush();
    expect(result).toEqual({ ok: true, data: { accepted: 1, devices: 2, pushOff: false } });
    expect(record).toHaveBeenCalledWith(["s1"]);
  });

  it("nothing accepted: nothing recorded as delivered", async () => {
    send.mockReset().mockResolvedValue({ outcome: "gone", status: 410, detail: null });
    await sendTestPush();
    expect(record).toHaveBeenCalledWith([]);
  });
});

describe("removeDevice and finishOnboarding (5.5)", () => {
  beforeEach(() => {
    removeOwn.mockReset();
    finish.mockReset();
  });

  it("removes one device by its id; anything that is not an id is refused before the database", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(await removeDevice({ id })).toEqual({ ok: true, data: null });
    expect(removeOwn).toHaveBeenCalledWith(id);
    const refused = await removeDevice({ id: "https://push.example/phone" });
    expect(refused.ok).toBe(false);
    expect(removeOwn).toHaveBeenCalledTimes(1);
  });

  it("the database's NOT_FOUND for someone else's device reaches the screen", async () => {
    removeOwn.mockRejectedValue({
      code: "P0001",
      message: "NOT_FOUND",
      details: "This device is not one of yours.",
    });
    const result = await removeDevice({ id: "00000000-0000-4000-8000-000000000002" });
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("finishes the walkthrough by test or Later, nothing else", async () => {
    finish.mockResolvedValue(true);
    expect(await finishOnboarding({ via: "later" })).toEqual({
      ok: true,
      data: { finished: true },
    });
    expect(finish).toHaveBeenCalledWith("later");
    const refused = await finishOnboarding({ via: "soon" as "later" });
    expect(refused.ok).toBe(false);
    expect(finish).toHaveBeenCalledTimes(1);
  });
});
