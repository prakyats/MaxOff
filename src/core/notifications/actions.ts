"use server";

import { revalidatePath } from "next/cache";

import { getCurrentMember } from "@/core/auth/server";
import { action, AppError, ok, type Result } from "@/core/errors";

import { pushEnvOrWarn, pushLoopbackAllowed } from "./env";
import { rpcOnboardingFinish } from "./onboarding";
import {
  type DeviceIdInput,
  deviceIdSchema,
  type EndpointInput,
  endpointSchema,
  type FinishOnboardingInput,
  finishOnboardingSchema,
  subscriptionSchema,
  type SubscriptionPayload,
} from "./push/schemas";
import { sendWebPush } from "./push/send";
import {
  listOwnPushSubscriptions,
  recordTestDelivered,
  rpcPushSubscriptionRemove,
  rpcPushSubscriptionRemoveOwn,
  rpcPushSubscriptionTurnOn,
  rpcPushTestClaim,
} from "./push/subscriptions";

/**
 * The member's own push subscriptions (task 5.2, WORKFLOWS §9a): zod → the member → the RPC →
 * revalidate → `Result`, each sent by a person's tap (ARCHITECTURE §4.4: the automatic
 * re-subscribe on load is a background call, `POST /api/push/subscription`, never an action).
 * `turnOnPush` for the member's own "Turn on" tap (the band, Me, the walkthrough), which alone
 * brings back a device removed from Me's list (owner 2026-10-06); `unsubscribePush` when this
 * device is signed out; `sendTestPush` for "Send a test notification"; `removeDevice` and
 * `finishOnboarding` (5.5) for Me's device list and a new joiner's walkthrough.
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

/** The member's tap on "Turn on" on this device: also the way back after Remove. */
export const turnOnPush = action(
  async (input: SubscriptionPayload): Promise<Result<{ id: string }>> => {
    const data = subscriptionSchema.parse(input);
    await requireCurrentMember();
    const id = await rpcPushSubscriptionTurnOn(data);
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
 *
 * **Since 5.5** a device whose push service accepted the test is recorded as delivered to (the
 * dispatcher's own "sent": `last_success_at`, owner decision 2026-10-03: accepted counts as
 * working), which ends the band, so the layout is revalidated then. **And** a test a device
 * received finishes a new joiner's walkthrough, wherever it was sent from (the walkthrough, the
 * band, Me → Help; owner 2026-10-06, 3); one no device accepted finishes nothing.
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
  const delivered: string[] = [];
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
    if (result.outcome === "sent") delivered.push(device.id);
  }
  await recordTestDelivered(delivered);
  if (delivered.length > 0) {
    await rpcOnboardingFinish("test");
    revalidateBanner();
  }
  return ok({ accepted: delivered.length, devices: devices.length, pushOff: false });
});

/**
 * "Remove" on Me's device list (5.5, owner decision 2026-10-03): notifications stop on one of the
 * member's own other devices, and stay off when it is opened again until "Turn on" is tapped there
 * (owner 2026-10-06). That device is not signed out. The database refuses anyone else's.
 */
export const removeDevice = action(async (input: DeviceIdInput): Promise<Result<null>> => {
  const data = deviceIdSchema.parse(input);
  await requireCurrentMember();
  await rpcPushSubscriptionRemoveOwn(data.id);
  revalidateBanner();
  return ok(null);
});

/**
 * A new joiner's walkthrough ends (5.5): "Later" (a delivered test finishes it inside
 * `sendTestPush`; 'test' here is still accepted, the database checking a device of theirs received
 * a push). Once; the band keeps nudging until push works. No revalidation: the walkthrough stays
 * on the screen until the member leaves it.
 */
export const finishOnboarding = action(
  async (input: FinishOnboardingInput): Promise<Result<{ finished: boolean }>> => {
    const data = finishOnboardingSchema.parse(input);
    await requireCurrentMember();
    return ok({ finished: await rpcOnboardingFinish(data.via) });
  },
);
