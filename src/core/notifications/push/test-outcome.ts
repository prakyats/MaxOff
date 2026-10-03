import type { TestPushResult } from "../actions";

/**
 * What "Send a test" says afterwards (task 5.2; Me's row since 5B decision 4, the band and a new
 * joiner's walkthrough since 5.5). `delivered` = a push service accepted it: that counts as
 * working (owner decision 2026-10-03), so the screens then ask "Did it arrive?".
 */
export function testOutcome(result: TestPushResult): { text: string; delivered: boolean } {
  if (result.pushOff) {
    return { text: "Push is not set up on the server yet: nothing was sent.", delivered: false };
  }
  if (result.devices === 0) return { text: "No device is turned on yet.", delivered: false };
  if (result.accepted === 0) {
    return {
      text: "No device accepted it. Check the device's notification settings, then try again.",
      delivered: false,
    };
  }
  return {
    text: result.accepted === 1 ? "Sent to 1 device" : `Sent to ${result.accepted} devices`,
    delivered: true,
  };
}
