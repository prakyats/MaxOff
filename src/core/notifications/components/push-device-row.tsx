"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

import { subscribePush } from "../actions";
import {
  browserSubscription,
  currentPermission,
  currentSupport,
  toPayload,
  trySubscribeBrowser,
} from "../push/browser";

/**
 * Me's device rows for notifications (task 5.2; WORKFLOWS "Settled at kickoff 5"; the owner's
 * 5A ask): **Notifications** says what this device is (on here; on for another device with
 * "Turn them on here too", the quiet row of decision 9; not on at all, which the banner also
 * says). One row always, so the card never changes height; only its words follow the device.
 * **Send a test notification** is its own row under "Help & troubleshooting" since 5B decision 4
 * (`PushTestRow`).
 */
type Device =
  | "checking"
  | "here"
  | "elsewhere"
  | "none"
  | "blocked"
  | "unavailable"
  // Allowed, but the browser could not subscribe (`subscribeFailureFor`, owner 2026-10-01).
  | "brave"
  | "failed";

export function PushDeviceRow({
  publicKey,
  endpoints,
}: {
  publicKey: string | null;
  /** The member's active endpoints (their own devices), from the server. */
  endpoints: readonly string[];
}) {
  const router = useRouter();
  const [device, setDevice] = useState<Device>("checking");

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
    const attempt = await trySubscribeBrowser(publicKey ?? "");
    if (!attempt.ok) {
      // Explained in the row with Try again, never the network Retry.
      setDevice(
        attempt.failure === "denied" ? "blocked" : attempt.failure === "brave" ? "brave" : "failed",
      );
      return;
    }
    const result = await subscribePush(toPayload(attempt.subscription));
    if (toastResult(result, { success: "Notifications are on for this device" })) router.refresh();
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
    brave: {
      title: "Notifications",
      body: "Brave blocks notifications by default: Settings → Privacy and security → turn on “Use Google services for push messaging”, then try again.",
      button: "Try again",
    },
    failed: {
      title: "Notifications",
      body: "This browser couldn't turn on notifications. Try again, or use Chrome, Safari or the installed app.",
      button: "Try again",
    },
  };
  const row = words[device];

  return (
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
  );
}
