"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

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
 */
export function PushSync({
  publicKey,
  endpoints,
}: {
  publicKey: string | null;
  endpoints: readonly string[];
}) {
  const router = useRouter();
  useEffect(() => {
    if (!publicKey || currentSupport().kind !== "ready" || currentPermission() !== "granted")
      return;
    let cancelled = false;
    (async () => {
      const existing = await browserSubscription();
      if (existing && endpoints.includes(existing.endpoint)) return;
      const subscription = existing ?? (await subscribeBrowser(publicKey));
      if (cancelled) return;
      const result = await subscribePush(toPayload(subscription));
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
