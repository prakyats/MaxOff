"use client";

import { sendRead } from "@/core/notifications/send-read";
import { Button } from "@/core/ui/primitives/button";

import { markAllNotificationsRead } from "../actions/inbox";

/**
 * "Mark all read" (kickoff 5 decision 4). Not the screen's commit: a neutral outline
 * (ARCHITECTURE §14.1's colour rule; Alerts has no red action). Every row shows as read and the
 * bell empties at once, on the device; the write goes in the background and never re-reads the
 * page (owner decision 2026-10-01). A write that fails is undone quietly by the server's next
 * count.
 */
export function MarkAllRead() {
  return (
    <Button
      variant="secondary"
      data-slot="mark-all-read"
      onClick={() => void sendRead(Number.POSITIVE_INFINITY, "all", markAllNotificationsRead)}
    >
      Mark all read
    </Button>
  );
}
