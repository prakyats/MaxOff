import { describe, expect, it } from "vitest";

import { operationalWarning } from "./env";
import { generateVapidKeysForTests } from "./push/encrypt";

/** The Owner's operational warning on Settings → Notifications (5.4): names only, never values. */
describe("operationalWarning", () => {
  async function complete() {
    const pair = await generateVapidKeysForTests();
    return {
      RESEND_API_KEY: "re_test_value",
      VAPID_PUBLIC_KEY: pair.publicKey,
      VAPID_PRIVATE_KEY: pair.privateKey,
      VAPID_SUBJECT: "mailto:owner@example.com",
      CRON_SECRET: "cron-test-value",
    };
  }

  it("is null when every setting is in place", async () => {
    expect(operationalWarning(await complete())).toBeNull();
  });

  it("names every missing or blank setting, in order", async () => {
    const env = await complete();
    expect(operationalWarning({ ...env, RESEND_API_KEY: undefined, CRON_SECRET: "  " })).toEqual({
      missing: ["RESEND_API_KEY", "CRON_SECRET"],
      invalid: [],
    });
    expect(operationalWarning({})).toEqual({
      missing: [
        "RESEND_API_KEY",
        "VAPID_PUBLIC_KEY",
        "VAPID_PRIVATE_KEY",
        "VAPID_SUBJECT",
        "CRON_SECRET",
      ],
      invalid: [],
    });
  });

  it("names the VAPID settings when all are set but push is still off", async () => {
    const env = await complete();
    expect(operationalWarning({ ...env, VAPID_PRIVATE_KEY: "abc" })).toEqual({
      missing: [],
      invalid: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"],
    });
  });

  it("never carries a value", async () => {
    const env = await complete();
    const warning = JSON.stringify(
      operationalWarning({ ...env, VAPID_PRIVATE_KEY: "abc", RESEND_API_KEY: "" }),
    );
    for (const value of Object.values(env)) expect(warning).not.toContain(value);
    expect(warning).not.toContain("abc");
  });
});
