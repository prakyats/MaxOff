import { beforeEach, describe, expect, it, vi } from "vitest";

const { claim, list, send, record, removeOwn, finish, upsert, turnOn } = vi.hoisted(() => ({
  upsert: vi.fn(),
  turnOn: vi.fn(),
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
  rpcPushSubscriptionUpsert: upsert,
  rpcPushSubscriptionTurnOn: turnOn,
  recordTestDelivered: record,
}));
vi.mock("./onboarding", () => ({ rpcOnboardingFinish: finish }));

import { finishOnboarding, removeDevice, sendTestPush, turnOnPush } from "./actions";

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

describe("a test a device received finishes the walkthrough, wherever it was sent from (owner 2026-10-06, 3)", () => {
  beforeEach(() => {
    claim.mockReset().mockResolvedValue(1);
    record.mockReset();
    finish.mockReset().mockResolvedValue(true);
    list.mockReset().mockResolvedValue([device]);
  });

  it("accepted by a device: recorded first, then the walkthrough finishes by test", async () => {
    const order: string[] = [];
    record.mockImplementation(async () => {
      order.push("record");
    });
    finish.mockImplementation(async () => {
      order.push("finish");
      return true;
    });
    send.mockReset().mockResolvedValue({ outcome: "sent", status: 201, detail: null });
    const result = await sendTestPush();
    expect(result).toEqual({ ok: true, data: { accepted: 1, devices: 1, pushOff: false } });
    expect(finish).toHaveBeenCalledWith("test");
    expect(order).toEqual(["record", "finish"]);
  });

  it("no device accepted it: the walkthrough is not finished", async () => {
    send.mockReset().mockResolvedValue({ outcome: "error", status: 500, detail: "http_500" });
    const result = await sendTestPush();
    expect(result).toMatchObject({ ok: true, data: { accepted: 0 } });
    expect(finish).not.toHaveBeenCalled();
  });
});

describe("turnOnPush is the tap (Remove sticks, owner 2026-10-06, 1)", () => {
  const payload = {
    endpoint: "https://push.example/phone",
    p256dh: `B${"A".repeat(86)}`,
    auth: "A".repeat(22),
    platform: "android" as const,
    isStandalone: false,
    label: null,
    userAgent: null,
  };

  beforeEach(() => {
    upsert.mockReset().mockResolvedValue("s1");
    turnOn.mockReset().mockResolvedValue("s1");
  });

  // The automatic re-subscribe is `POST /api/push/subscription` (its own route test).
  it("uses the turn-on that brings a removed device back, never the automatic upsert", async () => {
    expect(await turnOnPush(payload)).toEqual({ ok: true, data: { id: "s1" } });
    expect(turnOn).toHaveBeenCalledTimes(1);
    expect(upsert).not.toHaveBeenCalled();
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
