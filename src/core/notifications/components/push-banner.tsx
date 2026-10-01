"use client";

import { BellRingIcon, ShareIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { closeOverlaysThen } from "@/core/ui/overlay/overlay-history";
import { Button } from "@/core/ui/primitives/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/core/ui/primitives/sheet";
import { toastResult } from "@/core/ui/toast";

import { subscribePush } from "../actions";
import {
  currentPermission,
  currentSupport,
  type PushSupport,
  type SubscribeFailure,
  toPayload,
  trySubscribeBrowser,
} from "../push/browser";

/**
 * The enable-notifications band (kickoff 5 decision 9; WORKFLOWS "Settled at kickoff 5"; its
 * shape is 5A decision 30): judged **per member**, so the layout mounts it only while the member
 * has no working subscription on any device, the Owner included; once one device works it is
 * gone everywhere. No dismiss.
 *
 * **A slim one-line band pinned above the bottom bar, never at the top** (owner 2026-10-01): the
 * banner it replaces sat between the brand bar and the title bar and pushed every phone screen's
 * title and first rows 136 px down. The band is fixed, so nothing at the top of a screen moves;
 * its height is reserved (`--app-push-h`, `globals.css`: by `:has()` before hydration, then
 * measured, as the offline band's) and everything docked at the bottom, and the page's own
 * padding, sits above it (`--app-bands-h`), so no content hides behind it. It sits above the
 * offline band when both show.
 *
 * Tapping it opens a bottom sheet (a layer: back closes it) with the explanation and, on a device
 * that can ask, the permission button: **permission is asked only on that tap**. After hydration
 * the copy follows the device: iOS in a browser tab → "Install MaxOff…" and how; denied → how to
 * re-enable; no push at all → says so. Both band copies share one grid cell, so its height never
 * depends on the state.
 */
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
  // (`useSyncExternalStore`, as `useIsStandalone`).
  const detected = useSyncExternalStore(
    noSubscribe,
    () => stateFor(currentSupport(), publicKey),
    () => "loading" as const,
  );
  // The tap's own answer: a refusal is remembered without re-reading the device.
  const [refused, setRefused] = useState(false);
  const [open, setOpen] = useState(false);
  // A subscribe the browser could not complete after Allow (Brave's default, or any other): its
  // explanation in the sheet with Try again, never the network Retry (owner 2026-10-01).
  const [failure, setFailure] = useState<Exclude<SubscribeFailure, "denied"> | null>(null);
  const state: StateKey = refused ? "denied" : detected;

  const enable = useAction(async () => {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setRefused(true);
      return;
    }
    setFailure(null);
    const attempt = await trySubscribeBrowser(publicKey ?? "");
    if (!attempt.ok) {
      if (attempt.failure === "denied") setRefused(true);
      else setFailure(attempt.failure);
      return;
    }
    const result = await subscribePush(toPayload(attempt.subscription));
    if (toastResult(result, { success: "Notifications are on for this device" })) {
      // The sheet's history entry goes first (§14.2 e), then the layout drops the band.
      if (!closeOverlaysThen(() => router.refresh())) {
        setOpen(false);
        router.refresh();
      }
    }
  });

  // The band's real height (two lines at large text), published for everything docked above it.
  const band = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = band.current;
    if (!element) return;
    const html = document.documentElement;
    const measure = () => html.style.setProperty("--app-push-h", `${element.offsetHeight}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => {
      observer.disconnect();
      html.style.removeProperty("--app-push-h");
    };
  }, []);

  const bandKey: BandKey = state === "ios_not_installed" ? "install" : "off";
  const sheet = SHEET[failure ?? sheetKey(state, refused)];
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        ref={band}
        // From `md` up it starts after the sidebar (`w-60`), whose foot it would otherwise hide.
        data-slot="push-banner"
        data-state={state}
        className="pressable bg-muted text-foreground border-border fixed inset-x-0 bottom-[calc(var(--app-bottom-nav-h)+var(--app-safe-bottom)+var(--app-offline-h,0px))] z-30 grid min-h-11 border-t px-4 py-1.5 text-left text-sm md:left-60"
      >
        {BAND_KEYS.map((key) => {
          const shown = key === bandKey;
          return (
            <span
              key={key}
              data-copy={key}
              aria-hidden={shown ? undefined : true}
              className={`col-start-1 row-start-1 flex min-w-0 items-center justify-center gap-2 ${shown ? "" : "invisible"}`}
            >
              {key === "install" ? (
                <ShareIcon className="size-4 shrink-0" aria-hidden />
              ) : (
                <BellRingIcon className="size-4 shrink-0" aria-hidden />
              )}
              <span className="min-w-0">
                {BAND[key].text}
                <span aria-hidden> · </span>
                <span className="font-semibold underline underline-offset-2">
                  {BAND[key].action}
                </span>
              </span>
            </span>
          );
        })}
      </SheetTrigger>
      <SheetContent
        side="bottom"
        data-slot="push-sheet"
        data-failure={failure ?? undefined}
        className="max-h-[80dvh] gap-3 overflow-y-auto rounded-t-2xl pb-[calc(1.5rem+var(--app-safe-bottom))]"
      >
        <div
          aria-hidden
          className="bg-border pointer-events-none absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full"
        />
        <SheetHeader className="pt-3 pb-0">
          <SheetTitle>{sheet.title}</SheetTitle>
          <SheetDescription>{sheet.body}</SheetDescription>
        </SheetHeader>
        {sheet.button ? (
          <div className="flex flex-col gap-2 px-4">
            {/* The screen's one commit: permission is asked only here (decision 9). */}
            <Button
              variant="primary"
              className="h-11"
              onClick={() => enable.run()}
              pending={enable.pending}
              pendingLabel="Turning on…"
              data-slot="push-enable"
            >
              {sheet.button}
            </Button>
            <ActionStatus action={enable} />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

type BandKey = "off" | "install";

const BAND_KEYS: readonly BandKey[] = ["off", "install"];

/** The band's one line (owner 2026-10-01): "Notifications are off · Turn on". */
const BAND: Record<BandKey, { text: string; action: string }> = {
  off: { text: "Notifications are off", action: "Turn on" },
  install: { text: "Install MaxOff to get notifications", action: "How" },
};

type SheetKey =
  "ask" | "denied" | "refused" | "ios_not_installed" | "unsupported" | "off" | "brave" | "generic";

function sheetKey(state: StateKey, refused: boolean): SheetKey {
  switch (state) {
    case "loading":
    case "default":
    case "granted":
      return "ask";
    case "denied":
      return refused ? "refused" : "denied";
    default:
      return state;
  }
}

const DENIED_BODY =
  "Allow notifications for MaxOff in your browser's site settings (or the app's info screen), then come back.";

const SHEET: Record<SheetKey, { title: string; body: string; button: string | null }> = {
  ask: {
    title: "Turn on notifications",
    body: "Tasks, approvals and reminders reach you the moment they happen. Your device asks once.",
    button: "Turn on",
  },
  denied: { title: "Notifications are blocked on this device", body: DENIED_BODY, button: null },
  refused: { title: "Notifications were not allowed", body: DENIED_BODY, button: null },
  ios_not_installed: {
    title: "Install MaxOff to get notifications",
    body: 'iPhone notifies only the installed app: tap Share, then "Add to Home Screen", and open MaxOff from there.',
    button: null,
  },
  unsupported: {
    title: "This browser cannot receive notifications",
    body: "Open MaxOff in Chrome or Safari, or install it.",
    button: null,
  },
  off: {
    title: "Notifications are not set up yet",
    body: "The Owner has to finish the setup before devices can be turned on.",
    button: null,
  },
  // Allowed, but the browser could not subscribe (`subscribeFailureFor`, owner 2026-10-01).
  brave: {
    title: "Brave blocks notifications by default",
    body: "In Brave: Settings → Privacy and security → turn on “Use Google services for push messaging”, then try again.",
    button: "Try again",
  },
  generic: {
    title: "This browser couldn't turn on notifications",
    body: "Try again. If it keeps happening, open MaxOff in Chrome or Safari, or from the installed app.",
    button: "Try again",
  },
};
