"use client";

import type { ReactNode } from "react";

import { useRowReadShown } from "@/core/notifications/use-row-read";

/**
 * One row of the history. `data-unread` (the dot, the bold title) is the server's, less this
 * device's own reads the list was drawn before (owner decision 2026-10-01): a tap or Mark all
 * read shows at once, with no re-read of the page.
 */
export function NotificationRow({
  id,
  unread,
  countedAt,
  children,
}: {
  id: string;
  unread: boolean;
  countedAt: number;
  children: ReactNode;
}) {
  const readHere = useRowReadShown(id, countedAt);
  return (
    <li
      data-slot="notification-row"
      data-notification={id}
      data-unread={unread && !readHere ? "true" : undefined}
      className="group/row"
    >
      {children}
    </li>
  );
}
