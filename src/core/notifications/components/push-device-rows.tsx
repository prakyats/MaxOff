"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { Button } from "@/core/ui/primitives/button";
import { Separator } from "@/core/ui/primitives/separator";
import { toastResult } from "@/core/ui/toast";

import { sendTestPush, subscribePush, type TestPushResult } from "../actions";
import {
  browserSubscription,
  currentPermission,
  currentSupport,
  subscribeBrowser,
  toPayload,
} from "../push/browser";

/**
 * Me's device rows for notifications (task 5.2; WORKFLOWS "Settled at kickoff 5"; the owner's
 * 5A ask): **Notifications** says what this device is (on here; on for another device with
 * "Turn them on here too", the quiet row of decision 9; not on at all, which the banner also
 * says), and **Send a test notification** pushes to every active device of the member right
 * now, quiet hours ignored, and reports what the push services accepted. Two rows always, so
 * the card never changes height; only their words follow the device.
 */
type Device = "checking" | "here" | "elsewhere" | "none" | "blocked" | "unavailable";

function describe(result: TestPushResult): string {
  if (result.pushOff) return "Push is not set up on the server yet: nothing was sent.";
  if (result.devices === 0) return "No device is turned on yet.";
  if (result.accepted === 0)
    return "No device accepted it. Check the device's notification settings, then try again.";
  return result.accepted === 1 ? "Sent to 1 device" : `Sent to ${result.accepted} devices`;
}

export function PushDeviceRows({
  publicKey,
  endpoints,
}: {
  publicKey: string | null;
  /** The member's active endpoints (their own devices), from the server. */
  endpoints: readonly string[];
}) {
  const router = useRouter();
  const [device, setDevice] = useState<Device>("checking");
  const [testOutcome, setTestOutcome] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!publicKey || currentSupport().kind !== "ready") return "unavailable" as const;
      if (currentPermission() === "denied") return "blocked" as const;
      const current = await browserSubscription();
      if (current && endpoints.includes(current.endpoint)) return "here" as const;
      return endpoints.length > 0 ? ("elsewhere" as const) : ("none" as const);
    })()
      .then((next) => {
        if (!cancelled) setDevice(next);
      })
      .catch(() => {
        if (!cancelled) setDevice("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [publicKey, endpoints]);

  const enable = useAction(async () => {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setDevice("blocked");
      return;
    }
    const subscription = await subscribeBrowser(publicKey ?? "");
    const result = await subscribePush(toPayload(subscription));
    if (toastResult(result, { success: "Notifications are on for this device" })) router.refresh();
  });

  const test = useAction(async () => {
    const result = await sendTestPush();
    if (result.ok) setTestOutcome(describe(result.data));
    else toastResult(result);
  });

  const words: Record<Device, { title: string; body: string; button: string | null }> = {
    checking: { title: "Notifications", body: "Checking this device…", button: null },
    here: { title: "Notifications", body: "Notifications are on for this device.", button: null },
    elsewhere: {
      title: "Notifications",
      body: "Notifications are on for your phone. Turn them on here too.",
      button: "Turn on here",
    },
    none: { title: "Notifications", body: "Not turned on on any device yet.", button: "Turn on" },
    blocked: {
      title: "Notifications",
      body: "Blocked on this device. Allow notifications for MaxOff in the browser's site settings.",
      button: null,
    },
    unavailable: {
      title: "Notifications",
      body: "Not available on this device or browser. On iPhone, add MaxOff to the Home Screen first.",
      button: null,
    },
  };
  const row = words[device];

  return (
    <>
      <div
        data-slot="push-device-row"
        data-state={device}
        className="flex flex-wrap items-center justify-between gap-4"
      >
        <div className="min-w-0 flex-[1_1_10rem]">
          <p className="text-sm font-medium">{row.title}</p>
          <p className="text-muted-foreground text-sm">{row.body}</p>
          <ActionStatus action={enable} className="mt-1" />
        </div>
        {row.button ? (
          <Button
            variant="secondary"
            onClick={() => enable.run()}
            disabled={enable.pending}
            data-slot="push-enable"
          >
            {enable.pending ? "Turning on…" : row.button}
          </Button>
        ) : null}
      </div>
      <Separator />
      <div data-slot="push-test-row" className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-[1_1_10rem]">
          <p className="text-sm font-medium">Send a test notification</p>
          <p
            className="text-muted-foreground text-sm"
            data-slot="push-test-outcome"
            aria-live="polite"
          >
            {testOutcome ?? "A push to every device you turned on, right now, quiet hours or not."}
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
    </>
  );
}
