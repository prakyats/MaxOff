"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { subscribePush } from "../actions";
import {
  browserSubscription,
  currentPermission,
  currentSupport,
  subscribeBrowser,
  toPayload,
} from "../push/browser";

/**
 * Keeps this device's subscription in step with the server (task 5.2, WORKFLOWS §9a), on every
 * signed-in load and nothing else: with permission already granted, a browser subscription that
 * is missing (the browser dropped it) or whose endpoint the server does not hold for this member
 * (it changed, or the row went 'gone') is made again and stored. Never asks for permission: that
 * is the banner's tap. Renders nothing.
 *
 * **Remove sticks** (owner 2026-10-06): a device removed from Me's device list is refused here
 * (INVALID_STATE): it stays off however often it is opened, until "Turn on" is tapped on it. A
 * refused endpoint is not tried again while the signed-in layout stays mounted (its next refresh
 * would only be refused again).
 *
 * It also sends the app's report about itself once per open (5.4, owner decision 2026-10-03: its
 * platform and whether it runs installed), from a chunk of its own loaded here, push or no push.
 */
export function PushSync({
  publicKey,
  endpoints,
}: {
  publicKey: string | null;
  endpoints: readonly string[];
}) {
  const router = useRouter();
  // This browser's endpoint the server refused as removed.
  const refused = useRef<string | null>(null);
  useEffect(() => {
    import("../push/app-report")
      .then((module) => module.sendAppReportOnce())
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!publicKey || currentSupport().kind !== "ready" || currentPermission() !== "granted")
      return;
    let cancelled = false;
    (async () => {
      const existing = await browserSubscription();
      if (existing && endpoints.includes(existing.endpoint)) return;
      if (existing && existing.endpoint === refused.current) return;
      const subscription = existing ?? (await subscribeBrowser(publicKey));
      if (cancelled || subscription.endpoint === refused.current) return;
      const result = await subscribePush(toPayload(subscription));
      if (!result.ok && result.error.code === "INVALID_STATE") {
        refused.current = subscription.endpoint;
      }
      if (result.ok && !cancelled) router.refresh();
    })().catch((error: unknown) => {
      console.warn("Push re-subscribe failed", error);
    });
    return () => {
      cancelled = true;
    };
    // The endpoints list is the server's view at this render; a change re-runs the check.
  }, [publicKey, endpoints, router]);
  return null;
}
