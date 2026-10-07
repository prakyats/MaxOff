"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";
import { noteNotificationsChanged } from "@/core/notifications/live-state";

/**
 * A history row with something to open: `/open?n=<id>` reads it and opens its link. Not
 * prefetched (opening it is what reads it). The tap notes the change, so the list re-reads itself
 * when back brings it from the router's cache (`FreshOnReturn`).
 */
export function NotificationLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      onClick={noteNotificationsChanged}
      // Its own pressed state, as `NotificationReadButton` has (the shared `pressable-row`,
      // ARCHITECTURE §14.1 "Every tap is acknowledged").
      className={cn(
        className,
        "pressable-row focus-visible:ring-ring outline-none focus-visible:ring-2 focus-visible:ring-inset",
      )}
    >
      {children}
    </Link>
  );
}
