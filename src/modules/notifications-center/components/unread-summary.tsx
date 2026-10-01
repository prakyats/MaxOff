"use client";

import type { ServerUnread } from "@/core/notifications/read-receipts";
import { useUnreadShown } from "@/core/notifications/use-unread";

import { MarkAllRead } from "./mark-all-read";

/** "N unread" and Mark all read, following this device's own reads (owner decision 2026-10-01). */
export function UnreadSummary({ unread }: { unread: ServerUnread }) {
  const count = useUnreadShown(unread);
  return (
    <>
      <p className="text-muted-foreground min-w-0 text-sm" aria-live="polite">
        {count === 0 ? "All read" : `${count} unread`}
      </p>
      {count > 0 ? <MarkAllRead /> : null}
    </>
  );
}
