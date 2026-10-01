"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { staleSinceDrawn } from "@/core/notifications/live-state";

/**
 * Alerts shown again from the router's history cache (back from a row it opened) after the
 * member's notifications changed is re-read in place (`router.refresh()`), so the row just read
 * no longer shows as unread. `renderId` names this drawing of the list (one per server render).
 */
export function FreshOnReturn({ renderId }: { renderId: string }): null {
  const router = useRouter();
  useEffect(() => {
    if (staleSinceDrawn(renderId)) router.refresh();
  }, [renderId, router]);
  return null;
}
