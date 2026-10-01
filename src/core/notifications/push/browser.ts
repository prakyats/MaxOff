import { fromBase64Url, toBase64Url } from "./base64url";
import type { SubscriptionPayload } from "./schemas";

/**
 * The browser side of a subscription (task 5.2, WORKFLOWS §9a), no React: what the device
 * supports, the permission, and turning `PushManager` into the payload the server stores.
 * Pure functions take their inputs so the tests run them without a browser; the two that touch
 * `navigator` are thin.
 */
export type PushSupport =
  | { kind: "ready" }
  /** iOS Safari in a browser tab: push works only as the installed app. */
  | { kind: "ios_not_installed" }
  | { kind: "unsupported" };

export function pushSupport(input: {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  ios: boolean;
  standalone: boolean;
}): PushSupport {
  if (input.ios && !input.standalone) return { kind: "ios_not_installed" };
  if (!input.hasServiceWorker || !input.hasPushManager || !input.hasNotification) {
    return { kind: "unsupported" };
  }
  return { kind: "ready" };
}

export function isIOS(userAgent: string, maxTouchPoints: number): boolean {
  // iPadOS 13+ presents itself as a Mac; the touch points give it away.
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

export function platformOf(
  userAgent: string,
  maxTouchPoints: number,
): SubscriptionPayload["platform"] {
  if (isIOS(userAgent, maxTouchPoints)) return "ios";
  if (/Android/.test(userAgent)) return "android";
  if (/Windows|Macintosh|Linux|CrOS/.test(userAgent)) return "desktop";
  return "other";
}

/** A short device name for Me ("Android phone", "iPhone", "Windows"); never the raw agent. */
export function deviceLabel(userAgent: string, maxTouchPoints: number): string {
  if (/iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return "iPad";
  if (/iPhone|iPod/.test(userAgent)) return "iPhone";
  if (/Android/.test(userAgent)) return "Android phone";
  if (/Windows/.test(userAgent)) return "Windows";
  if (/Macintosh/.test(userAgent)) return "Mac";
  if (/CrOS/.test(userAgent)) return "Chromebook";
  if (/Linux/.test(userAgent)) return "Linux";
  return "This device";
}

export function currentSupport(): PushSupport {
  if (typeof window === "undefined") return { kind: "unsupported" };
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const standalone =
    (window.matchMedia?.("(display-mode: standalone)").matches ?? false) || nav.standalone === true;
  return pushSupport({
    hasServiceWorker: "serviceWorker" in nav,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
    ios: isIOS(nav.userAgent, nav.maxTouchPoints ?? 0),
    standalone,
  });
}

export function currentPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/** The payload the server stores for a browser subscription. */
export function toPayload(subscription: PushSubscription): SubscriptionPayload {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const p256dh = subscription.getKey("p256dh");
  const auth = subscription.getKey("auth");
  if (!p256dh || !auth) throw new Error("The subscription has no keys");
  const standalone =
    (window.matchMedia?.("(display-mode: standalone)").matches ?? false) || nav.standalone === true;
  return {
    endpoint: subscription.endpoint,
    p256dh: toBase64Url(new Uint8Array(p256dh)),
    auth: toBase64Url(new Uint8Array(auth)),
    platform: platformOf(nav.userAgent, nav.maxTouchPoints ?? 0),
    isStandalone: standalone,
    label: deviceLabel(nav.userAgent, nav.maxTouchPoints ?? 0),
    userAgent: nav.userAgent.slice(0, 512),
  };
}

export async function browserSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/** Subscribes this browser with the server's VAPID public key (permission already granted). */
export async function subscribeBrowser(publicKey: string): Promise<PushSubscription> {
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: fromBase64Url(publicKey).slice().buffer as ArrayBuffer,
  });
}

/**
 * Why `pushManager.subscribe` failed after permission was granted, as the screens word it
 * (owner 2026-10-01, found on Brave desktop): `denied` when the browser refused it after all
 * (`NotAllowedError`: the permission was taken back meanwhile), `brave` for any other failure on
 * Brave, which turns Google's push service off by default ("Use Google services for push
 * messaging"), and `generic` for every other browser. Never a thrown error: a failed subscribe
 * is something to explain, not a request to retry, so the screen never falls into Retry.
 */
export type SubscribeFailure = "denied" | "brave" | "generic";

export function subscribeFailureFor(error: unknown, browser: { brave: boolean }): SubscribeFailure {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";
  if (name === "NotAllowedError") return "denied";
  return browser.brave ? "brave" : "generic";
}

/** Brave announces itself with `navigator.brave.isBrave()` (its user agent reads as Chrome). */
export function isBrave(nav: unknown): boolean {
  if (typeof nav !== "object" || nav === null || !("brave" in nav)) return false;
  const brave = (nav as { brave: unknown }).brave;
  return (
    typeof brave === "object" &&
    brave !== null &&
    typeof (brave as { isBrave?: unknown }).isBrave === "function"
  );
}

/** `subscribeBrowser` that answers instead of throwing: the subscription, or why it failed. */
export async function trySubscribeBrowser(
  publicKey: string,
): Promise<
  { ok: true; subscription: PushSubscription } | { ok: false; failure: SubscribeFailure }
> {
  try {
    return { ok: true, subscription: await subscribeBrowser(publicKey) };
  } catch (error) {
    return { ok: false, failure: subscribeFailureFor(error, { brave: isBrave(navigator) }) };
  }
}
