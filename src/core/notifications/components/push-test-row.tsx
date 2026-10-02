"use client";

import { useState } from "react";

import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

import { sendTestPush, type TestPushResult } from "../actions";

function describe(result: TestPushResult): string {
  if (result.pushOff) return "Push is not set up on the server yet: nothing was sent.";
  if (result.devices === 0) return "No device is turned on yet.";
  if (result.accepted === 0)
    return "No device accepted it. Check the device's notification settings, then try again.";
  return result.accepted === 1 ? "Sent to 1 device" : `Sent to ${result.accepted} devices`;
}

/**
 * **Send a test notification** (task 5.2; under Me's "Help & troubleshooting" since 5B decision
 * 4): pushes to every active device of the member right now, quiet hours ignored, and reports
 * what the push services accepted. One row whose words follow the outcome.
 */
export function PushTestRow({
  endpoints,
}: {
  /** The member's active endpoints (their own devices), from the server. */
  endpoints: readonly string[];
}) {
  const [outcome, setOutcome] = useState<string | null>(null);
  const test = useAction(async () => {
    const result = await sendTestPush();
    if (result.ok) setOutcome(describe(result.data));
    else toastResult(result);
  });
  return (
    <div data-slot="push-test-row" className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0 flex-[1_1_10rem]">
        <p className="text-sm font-medium">Send a test notification</p>
        <p
          className="text-muted-foreground text-sm"
          data-slot="push-test-outcome"
          aria-live="polite"
        >
          {outcome ?? "A push to every device you turned on, right now, quiet hours or not."}
        </p>
        <ActionStatus action={test} className="mt-1" />
      </div>
      <Button
        variant="secondary"
        onClick={() => test.run()}
        disabled={test.pending || endpoints.length === 0}
        data-slot="push-test"
      >
        {test.pending ? "Sending…" : "Send test"}
      </Button>
    </div>
  );
}
