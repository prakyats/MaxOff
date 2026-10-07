"use client";

import { type ReactNode, useRef } from "react";

import { cn } from "@/core/lib/utils";
import { sendRead } from "@/core/notifications/send-read";

import { markNotificationRead } from "../actions/inbox";

/**
 * A history row with nothing to open (someone who lost access to what it was about, kickoff 5
 * decision 25): a tap reads it. The row's own content, pressed like any row. The row shows as
 * read and the bell drops at once, on the device; the write goes in the background and never
 * re-reads the page (owner decision 2026-10-01). A write that fails is undone quietly by the
 * server's next count: the row is unread again, no toast.
 */
export function NotificationReadButton({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  // One read per row at a time: a second tap would take it off the count twice until the
  // answer. A failed one can be tapped again once the server's next count shows it unread.
  const sent = useRef(false);
  return (
    <button
      type="button"
      data-slot="notification-read"
      onClick={() => {
        if (sent.current) return;
        sent.current = true;
        void sendRead(1, [id], () => markNotificationRead({ id })).then((written) => {
          if (!written) sent.current = false;
        });
      }}
      className={cn(
        className,
        "pressable-row focus-visible:ring-ring outline-none focus-visible:ring-2 focus-visible:ring-inset",
      )}
    >
      {children}
    </button>
  );
}
