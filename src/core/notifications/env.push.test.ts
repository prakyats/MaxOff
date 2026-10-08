import { describe, expect, it } from "vitest";

import { pushLoopbackAllowed, pushStartupWarning, readPushEnv } from "./env";
import { generateReceiverKeys, generateVapidKeysForTests } from "./push/encrypt";
import { subscriptionSchema } from "./push/schemas";

describe("readPushEnv", () => {
  it("is on with three well-formed values (throwaway keys made here)", async () => {
    const pair = await generateVapidKeysForTests();
    const env = {
      VAPID_PUBLIC_KEY: pair.publicKey,
      VAPID_PRIVATE_KEY: pair.privateKey,
      VAPID_SUBJECT: "mailto:owner@example.com",
    };
    expect(readPushEnv(env)).toEqual({
      mode: "on",
      ...{
        publicKey: pair.publicKey,
        privateKey: pair.privateKey,
        subject: "mailto:owner@example.com",
      },
    });
    expect(readPushEnv({ ...env, VAPID_SUBJECT: "https://app.example" }).mode).toBe("on");
    expect(pushStartupWarning(env)).toBeNull();
  });

  it("is off, naming the variable and never the value, when anything is missing or malformed", async () => {
    const pair = await generateVapidKeysForTests();
    const env = {
      VAPID_PUBLIC_KEY: pair.publicKey,
      VAPID_PRIVATE_KEY: pair.privateKey,
      VAPID_SUBJECT: "mailto:owner@example.com",
    };
    expect(readPushEnv({})).toEqual({
      mode: "off",
      reason: "VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT not set",
    });
    expect(readPushEnv({ ...env, VAPID_PRIVATE_KEY: " " })).toMatchObject({
      mode: "off",
      reason: "VAPID_PRIVATE_KEY not set",
    });
    const short = readPushEnv({ ...env, VAPID_PRIVATE_KEY: "abc" });
    expect(short).toMatchObject({ mode: "off" });
    expect(short.mode === "off" && short.reason).toContain(
      "VAPID_PRIVATE_KEY must be 43 characters",
    );
    expect(short.mode === "off" && short.reason).not.toContain(pair.privateKey);
    expect(readPushEnv({ ...env, VAPID_PUBLIC_KEY: `A${pair.publicKey.slice(1)}` })).toMatchObject({
      mode: "off",
      reason: expect.stringContaining("uncompressed P-256 point"),
    });
    expect(readPushEnv({ ...env, VAPID_SUBJECT: "owner@example.com" })).toMatchObject({
      mode: "off",
      reason: expect.stringContaining("mailto: or https:"),
    });
    expect(pushStartupWarning({})).toContain("VAPID_PUBLIC_KEY");
  });
});

describe("pushLoopbackAllowed (5A review M2)", () => {
  it("only with the e2e switch, and never in staging or production", () => {
    expect(pushLoopbackAllowed({})).toBe(false);
    expect(pushLoopbackAllowed({ PUSH_ALLOW_LOOPBACK_ENDPOINTS: "1" })).toBe(true);
    expect(
      pushLoopbackAllowed({ PUSH_ALLOW_LOOPBACK_ENDPOINTS: "1", NEXT_PUBLIC_APP_ENV: "local" }),
    ).toBe(true);
    for (const appEnv of ["staging", "production"]) {
      expect(
        pushLoopbackAllowed({ PUSH_ALLOW_LOOPBACK_ENDPOINTS: "1", NEXT_PUBLIC_APP_ENV: appEnv }),
      ).toBe(false);
    }
  });
});

describe("subscriptionSchema: the keys exactly as a browser makes them (5A review M1)", () => {
  it("takes a real subscription's keys and refuses anything else", async () => {
    const keys = await generateReceiverKeys();
    const base = {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      p256dh: keys.publicKey,
      auth: keys.auth,
      platform: "android" as const,
      isStandalone: true,
      label: null,
      userAgent: null,
    };
    expect(subscriptionSchema.safeParse(base).success).toBe(true);
    for (const [p256dh, auth] of [
      ["k", keys.auth],
      ["A" + "A".repeat(86), keys.auth],
      ["B" + "+".repeat(86), keys.auth],
      [keys.publicKey + "=", keys.auth],
      [keys.publicKey, "a"],
      [keys.publicKey, "A".repeat(23)],
      [keys.publicKey, keys.auth + "=="],
    ]) {
      expect(
        subscriptionSchema.safeParse({ ...base, p256dh, auth }).success,
        `${p256dh} ${auth}`,
      ).toBe(false);
    }
  });
});
