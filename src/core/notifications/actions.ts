"use server";

import { revalidatePath } from "next/cache";

import { getCurrentMember } from "@/core/auth/server";
import { action, AppError, ok, type Result } from "@/core/errors";

import { pushEnvOrWarn, pushLoopbackAllowed } from "./env";
import {
  type EndpointInput,
  endpointSchema,
  subscriptionSchema,
  type SubscriptionPayload,
} from "./push/schemas";
import { sendWebPush } from "./push/send";
import {
  listOwnPushSubscriptions,
  rpcPushSubscriptionRemove,
  rpcPushSubscriptionUpsert,
  rpcPushTestClaim,
} from "./push/subscriptions";

/**
 * The member's own push subscriptions (task 5.2, WORKFLOWS §9a): zod → the member → the RPC →
 * revalidate → `Result`. `subscribePush` after the browser subscribed (the banner, Me, the
 * re-subscribe on load); `unsubscribePush` when this device is signed out; `sendTestPush`
 * for "Send a test notification" on Me.
 */
async function requireCurrentMember() {
  const member = await getCurrentMember();
  if (!member) throw new AppError("UNAUTHENTICATED");
  return member;
}

/** The whole signed-in tree carries the banner, so all of it refreshes. */
function revalidateBanner(): void {
  revalidatePath("/", "layout");
}

export const subscribePush = action(
  async (input: SubscriptionPayload): Promise<Result<{ id: string }>> => {
    const data = subscriptionSchema.parse(input);
    await requireCurrentMember();
    const id = await rpcPushSubscriptionUpsert(data);
    revalidateBanner();
    return ok({ id });
  },
);

export const unsubscribePush = action(async (input: EndpointInput): Promise<Result<null>> => {
  const data = endpointSchema.parse(input);
  await requireCurrentMember();
  await rpcPushSubscriptionRemove(data.endpoint);
  revalidateBanner();
  return ok(null);
});

export type TestPushResult = {
  /** Devices the push service accepted the test for. */
  accepted: number;
  /** The caller's active devices. */
  devices: number;
  /** Push is off on the server (no VAPID keys): nothing was sent. */
  pushOff: boolean;
};

/**
 * "Send a test notification": a push right now to every active device of the caller, quiet
 * hours ignored (kickoff 5 decision 5's one exception), no notifications row (a device check,
 * not an event). Reports what the push services accepted; a device that answered gone or an
 * error is left to the dispatcher's next real push to disable. One test per 30 seconds: the
 * database claims it (stamping last_test_at) before anything is sent, and refuses a second tap
 * inside the window with RATE_LIMITED and a friendly message (5A review S2).
 */
export const sendTestPush = action(async (): Promise<Result<TestPushResult>> => {
  const member = await requireCurrentMember();
  const push = pushEnvOrWarn();
  if (push.mode === "off") {
    const devices = (await listOwnPushSubscriptions()).filter((row) => row.disabledReason === null);
    return ok({ accepted: 0, devices: devices.length, pushOff: true });
  }
  await rpcPushTestClaim();
  const devices = (await listOwnPushSubscriptions()).filter((row) => row.disabledReason === null);
  let accepted = 0;
  for (const device of devices) {
    const result = await sendWebPush({
      target: { endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth },
      message: {
        title: "MaxOff notifications are on",
        body: `This is your test, ${member.name.split(" ")[0] ?? member.name}. Nothing to do.`,
        url: "/me",
        tag: "test",
        notificationId: null,
        group: "other",
      },
      vapid: { publicKey: push.publicKey, privateKey: push.privateKey, subject: push.subject },
      fetch: (url, init) => fetch(url, init),
      urgency: "high",
      allowLoopback: pushLoopbackAllowed(),
    });
    if (result.outcome === "sent") accepted += 1;
  }
  return ok({ accepted, devices: devices.length, pushOff: false });
});
