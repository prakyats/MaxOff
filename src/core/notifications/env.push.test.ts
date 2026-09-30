import { describe, expect, it } from "vitest";

import { pushStartupWarning, readPushEnv } from "./env";
import { generateVapidKeysForTests } from "./push/encrypt";

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
