"use client";

import { BellRingIcon, ShareIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

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
import { changeBottomReserve } from "@/core/ui/viewport/bottom-reserve";

import { sendTestPush } from "../actions";
import {
  BAND_COPY,
  BAND_KEYS,
  type BandDevice,
  type BandKey,
  type BandReason,
  bandKeyFor,
} from "../push/band";
import { currentPermission, currentSupport, isBrave, type PushSupport } from "../push/browser";
import { testOutcome } from "../push/test-outcome";
import { troubleDeviceOf, troubleshootingFor } from "../push/troubleshooting";
import { turnOnHere } from "../push/turn-on";
import { InstallSteps } from "./install-steps";

/**
 * The notifications band (kickoff 5 decision 9; WORKFLOWS "Settled at kickoff 5"; its shape is
 * 5A decision 30; **when and what since 5.5**, owner decisions 2026-10-03): judged **per member**,
 * the layout mounts it while `app.push_band` gives a reason: until one of the member's devices
 * has received a push (a test or a real one) and is not failing, and again whenever their
 * reachability is not `ok`. The Owner's own problem is this same band. No dismiss.
 *
 * **Its words follow the reason** (`bandKeyFor`): notifications off, blocked, an iPhone without
 * the installed app ("Install MaxOff to get notifications · How", as before), failing, or on but
 * nothing received yet ("Send a test"). Every line shares one grid cell, so the band's height never
 * depends on which shows.
 *
 * **A slim one-line band pinned above the bottom bar, never at the top** (owner 2026-10-01): fixed,
 * its height reserved (`--app-push-h`, `globals.css`: by `:has()` before hydration, then
 * measured) and everything docked at the bottom, and the page's own padding, sits above it
 * (`--app-bands-h`). It sits above the offline band when both show.
 *
 * Tapping it opens a bottom sheet (a layer: back closes it) with the explanation and its one
 * action: **Turn on** (permission is asked only on that tap), the illustrated install steps, or
 * **Send a test** (a test the push service accepts ends the band; one it doesn't shows what to
 * check on this device).
 */
type PermissionKey = "loading" | "default" | "denied" | "granted" | BandDevice;

function deviceOf(support: PushSupport): BandDevice {
  return support.kind;
}

function permissionFor(support: PushSupport): PermissionKey {
  if (support.kind !== "ready") return support.kind;
  const permission = currentPermission();
  return permission === "unsupported" ? "denied" : permission;
}

/** Never subscribes: the device's support does not change while the page is open. */
const noSubscribe = () => () => {};

export function PushBanner({
  publicKey,
  reason,
}: {
  publicKey: string | null;
  /** Why the band shows (`app.push_band`, read in the layout with the endpoints). */
  reason: BandReason;
}) {
  const router = useRouter();
  // "unknown" / "loading" on the server and the first client render, then the device's real
  // state (`useSyncExternalStore`, as `useIsStandalone`).
  const device = useSyncExternalStore(
    noSubscribe,
    () => deviceOf(currentSupport()),
    () => "unknown" as const,
  );
  const detected = useSyncExternalStore(
    noSubscribe,
    () => permissionFor(currentSupport()),
    () => "loading" as const,
  );
  // The tap's own answer: a refusal is remembered without re-reading the device.
  const [refused, setRefused] = useState(false);
  const [open, setOpen] = useState(false);
  // A subscribe the browser could not complete after Allow (Brave's default, or any other): its
  // explanation in the sheet with Try again, never the network Retry (owner 2026-10-01).
  const [failure, setFailure] = useState<"brave" | "generic" | null>(null);
  // A test no device accepted: what to check here.
  const [testFailed, setTestFailed] = useState<string | null>(null);
  const permission: PermissionKey = refused ? "denied" : detected;

  // The sheet's history entry goes first (§14.2 e), then the layout drops or rewords the band.
  const closeAndRefresh = () => {
    if (!closeOverlaysThen(() => router.refresh())) {
      setOpen(false);
      router.refresh();
    }
  };

  const enable = useAction(async () => {
    setFailure(null);
    const outcome = await turnOnHere(publicKey ?? "");
    if (outcome.kind === "blocked") setRefused(true);
    else if (outcome.kind === "brave") setFailure("brave");
    else if (outcome.kind === "failed") setFailure("generic");
    else if (outcome.kind === "on") {
      toast.success("Notifications are on for this device");
      closeAndRefresh();
    } else toastResult(outcome.result);
  });

  const test = useAction(async () => {
    setTestFailed(null);
    const result = await sendTestPush();
    if (!result.ok) {
      toastResult(result);
      return;
    }
    const outcome = testOutcome(result.data);
    if (outcome.delivered) {
      toast.success(`Test ${outcome.text.toLowerCase()}`);
      closeAndRefresh();
    } else setTestFailed(outcome.text);
  });

  // The band's real height (two lines at large text), published for everything docked above it.
  const band = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = band.current;
    if (!element) return;
    const html = document.documentElement;
    // A taller band keeps a person at the page's end there (`changeBottomReserve`).
    const measure = () =>
      changeBottomReserve(() =>
        html.style.setProperty("--app-push-h", `${element.offsetHeight}px`),
      );
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => {
      observer.disconnect();
      html.style.removeProperty("--app-push-h");
    };
  }, []);

  const bandKey = bandKeyFor(reason, device);
  const sheet = sheetFor({ bandKey, permission, refused, failure, publicKey });
  const pending = enable.pending || test.pending;
  const runSheetAction = () => (sheet.action === "test" ? test.run() : enable.run());
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        ref={band}
        // From `md` up it starts after the sidebar (`w-60`), whose foot it would otherwise hide.
        data-slot="push-banner"
        data-state={permission}
        data-reason={bandKey}
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
                {BAND_COPY[key].text}
                <span aria-hidden> · </span>
                <span className="font-semibold underline underline-offset-2">
                  {BAND_COPY[key].action}
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
        {sheet.install ? (
          <div className="px-4">
            <InstallSteps />
          </div>
        ) : null}
        {sheet.button ? (
          <div className="flex flex-col gap-2 px-4">
            {/* The sheet's one commit: permission is asked only here (decision 9). */}
            <Button
              variant="primary"
              className="h-11"
              onClick={runSheetAction}
              pending={pending}
              pendingLabel={sheet.action === "test" ? "Sending…" : "Turning on…"}
              data-slot={sheet.action === "test" ? "push-band-test" : "push-enable"}
            >
              {sheet.button}
            </Button>
            <ActionStatus action={sheet.action === "test" ? test : enable} />
          </div>
        ) : null}
        {testFailed ? <TestFailed outcome={testFailed} /> : null}
      </SheetContent>
    </Sheet>
  );
}

/** A test no device accepted: the outcome, and what to check on this phone or browser. */
function TestFailed({ outcome }: { outcome: string }) {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const help = troubleshootingFor(
    troubleDeviceOf({
      userAgent: nav.userAgent,
      maxTouchPoints: nav.maxTouchPoints ?? 0,
      standalone:
        (window.matchMedia?.("(display-mode: standalone)").matches ?? false) ||
        nav.standalone === true,
      brave: isBrave(nav),
    }),
  );
  return (
    <div data-slot="push-band-test-failed" className="flex flex-col gap-2 px-4 text-sm">
      <p aria-live="polite">{outcome}</p>
      <p className="font-medium">{help.title}</p>
      <ol className="text-muted-foreground flex list-decimal flex-col gap-1 pl-5">
        {help.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

interface SheetCopy {
  title: string;
  body: string;
  button: string | null;
  action: "enable" | "test" | null;
  install: boolean;
}

const DENIED_BODY =
  "Allow notifications for MaxOff in your browser's site settings (or the app's info screen), then come back.";

function sheetFor(input: {
  bandKey: BandKey;
  permission: PermissionKey;
  refused: boolean;
  failure: "brave" | "generic" | null;
  publicKey: string | null;
}): SheetCopy {
  const { bandKey, permission, refused, failure, publicKey } = input;
  const none = { button: null, action: null, install: false } as const;
  if (!publicKey) {
    return {
      title: "Notifications are not set up yet",
      body: "The Owner has to finish the setup before devices can be turned on.",
      ...none,
    };
  }
  if (bandKey === "install") {
    return {
      title: "Install MaxOff to get notifications",
      body: "iPhone notifies only the installed app. It takes four taps:",
      button: null,
      action: null,
      install: true,
    };
  }
  if (bandKey === "unconfirmed" || bandKey === "failing") {
    return {
      title:
        bandKey === "failing"
          ? "Notifications aren't reaching you"
          : "Check notifications reach you",
      body:
        bandKey === "failing"
          ? "Your devices keep failing to get notifications. Send yourself a test: once one arrives, they work again."
          : "Notifications are on, but none has reached you yet. Send yourself a test to make sure.",
      button: "Send a test",
      action: "test",
      install: false,
    };
  }
  // "off" and "blocked": turned on from this device.
  if (failure === "brave") {
    return {
      title: "Brave blocks notifications by default",
      body: "In Brave: Settings → Privacy and security → turn on “Use Google services for push messaging”, then try again.",
      button: "Try again",
      action: "enable",
      install: false,
    };
  }
  if (failure === "generic") {
    return {
      title: "This browser couldn't turn on notifications",
      body: "Try again. If it keeps happening, open MaxOff in Chrome or Safari, or from the installed app.",
      button: "Try again",
      action: "enable",
      install: false,
    };
  }
  if (permission === "unsupported") {
    return {
      title: "This browser cannot receive notifications",
      body: "Open MaxOff in Chrome or Safari, or install it.",
      ...none,
    };
  }
  if (permission === "denied") {
    return {
      title: refused
        ? "Notifications were not allowed"
        : "Notifications are blocked on this device",
      body: DENIED_BODY,
      ...none,
    };
  }
  return bandKey === "blocked"
    ? {
        title: "Notifications are blocked",
        body: "A device of yours stopped getting notifications because they were blocked there. Turn them on here, or allow them again on that device.",
        button: "Turn on",
        action: "enable",
        install: false,
      }
    : {
        title: "Turn on notifications",
        body: "Tasks, approvals and reminders reach you the moment they happen. Your device asks once.",
        button: "Turn on",
        action: "enable",
        install: false,
      };
}
