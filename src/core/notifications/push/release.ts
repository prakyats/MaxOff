import { browserSubscription } from "./browser";

/**
 * "Sign out of this device" (kickoff 5 decision 1): drops the browser's push subscription and
 * returns its endpoint, so the sign-out action deletes the row. Never throws: a device with no
 * subscription, or a browser that refuses, still signs out.
 */
export async function releaseThisDevice(): Promise<string | null> {
  try {
    const subscription = await browserSubscription();
    if (!subscription) return null;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe().catch(() => false);
    return endpoint;
  } catch {
    return null;
  }
}
