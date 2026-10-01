"use client";

import Link from "next/link";
import type { ReactNode } from "react";

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
    <Link href={href} prefetch={false} className={className} onClick={noteNotificationsChanged}>
      {children}
    </Link>
  );
}
