"use client";

import { BellRingIcon, ShareIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

import { subscribePush } from "../actions";
import {
  currentPermission,
  currentSupport,
  type PushSupport,
  subscribeBrowser,
  toPayload,
} from "../push/browser";

/**
 * The enable-notifications banner (kickoff 5 decision 9; WORKFLOWS "Settled at kickoff 5"):
 * judged **per member**, so the layout mounts it on every screen only while the member has no
 * working subscription on any device, the Owner included; once one device works it is gone
 * everywhere. No dismiss. Permission is asked only on the tap. Server-rendered in its default
 * shape, so nothing moves when the page arrives; after hydration the text follows the device:
 * denied → how to re-enable; iOS in a browser tab → "Add to Home Screen" (push needs the
 * installed app); no push at all → says so. One row high in every state.
 */
/** The device's state as one key: what the banner says follows it. */
type StateKey =
  "loading" | "default" | "denied" | "granted" | "ios_not_installed" | "unsupported" | "off";

function stateFor(support: PushSupport, publicKey: string | null): StateKey {
  if (!publicKey) return "off";
  if (support.kind !== "ready") return support.kind;
  const permission = currentPermission();
  return permission === "unsupported" ? "denied" : permission;
}

/** Never subscribes: the device's support does not change while the page is open. */
const noSubscribe = () => () => {};

export function PushBanner({ publicKey }: { publicKey: string | null }) {
  const router = useRouter();
  // "loading" on the server and the first client render, then the device's real state
  // (`useSyncExternalStore`, as `useIsStandalone`): one row high either way, so nothing moves.
  const detected = useSyncExternalStore(
    noSubscribe,
    () => stateFor(currentSupport(), publicKey),
    () => "loading" as const,
  );
  // The tap's own answer: a refusal is remembered without re-reading the device.
  const [refused, setRefused] = useState(false);
  const state: StateKey = refused ? "denied" : detected;

  const enable = useAction(async () => {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setRefused(true);
      return;
    }
    const subscription = await subscribeBrowser(publicKey ?? "");
    const result = await subscribePush(toPayload(subscription));
    if (toastResult(result, { success: "Notifications are on for this device" })) router.refresh();
  });

  const copy = bannerCopy(state, refused);
  return (
    <section
      data-slot="push-banner"
      data-state={state}
      aria-label="Notifications"
      className="bg-muted/40 ring-foreground/10 mb-4 flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl px-4 py-3 ring-1"
    >
      <div className="flex min-w-0 flex-[1_1_14rem] items-start gap-3">
        {state === "ios_not_installed" ? (
          <ShareIcon className="text-foreground mt-0.5 size-5 shrink-0" aria-hidden />
        ) : (
          <BellRingIcon className="text-foreground mt-0.5 size-5 shrink-0" aria-hidden />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium">{copy.title}</p>
          <p className="text-muted-foreground text-sm">{copy.body}</p>
          <ActionStatus action={enable} className="mt-1" />
        </div>
      </div>
      {copy.button ? (
        <Button
          variant="secondary"
          onClick={() => enable.run()}
          disabled={enable.pending}
          data-slot="push-enable"
        >
          {enable.pending ? "Turning on…" : copy.button}
        </Button>
      ) : null}
    </section>
  );
}

function bannerCopy(
  state: StateKey,
  refused: boolean,
): { title: string; body: string; button: string | null } {
  const ask = {
    title: "Turn on notifications",
    body: "Tasks, approvals and reminders reach you the moment they happen.",
    button: "Turn on",
  };
  switch (state) {
    case "loading":
    case "default":
    case "granted":
      return ask;
    case "denied":
      return {
        title: refused
          ? "Notifications were not allowed"
          : "Notifications are blocked on this device",
        body: "To turn them on, allow notifications for MaxOff in your browser's site settings (the lock icon by the address, or the app's info screen on a phone), then come back here.",
        button: null,
      };
    case "ios_not_installed":
      return {
        title: "Add MaxOff to your Home Screen for notifications",
        body: 'On iPhone, notifications work only from the installed app: tap Share, then "Add to Home Screen", and open MaxOff from there.',
        button: null,
      };
    case "unsupported":
      return {
        title: "This browser cannot receive notifications",
        body: "Open MaxOff in Chrome or Safari, or install it, to be notified.",
        button: null,
      };
    case "off":
      return {
        title: "Notifications are not set up yet",
        body: "The Owner has to finish the notification setup before devices can be turned on.",
        button: null,
      };
  }
}
