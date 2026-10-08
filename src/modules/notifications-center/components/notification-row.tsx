"use client";

import type { ReactNode } from "react";

import { useRowReadShown } from "@/core/notifications/use-row-read";

/**
 * One row of the history. `data-unread` (the dot, the bold title) is the server's, less this
 * device's own reads the list was drawn before (owner decision 2026-10-01): a tap or Mark all
 * read shows at once, with no re-read of the page. A row holding a run of notifications about one
 * record (`data-run`) is the newest one's: opening it reads that one, the record's page the rest,
 * and the list is read again on return (`FreshOnReturn`).
 */
export function NotificationRow({
  id,
  unread,
  countedAt,
  runSize = 1,
  children,
}: {
  id: string;
  unread: boolean;
  countedAt: number;
  /** How many notifications the row holds (5B decision 10). */
  runSize?: number;
  children: ReactNode;
}) {
  const readHere = useRowReadShown(id, countedAt);
  return (
    <li
      data-slot="notification-row"
      data-notification={id}
      data-unread={unread && !readHere ? "true" : undefined}
      data-run={runSize > 1 ? runSize : undefined}
      className="group/row"
    >
      {children}
    </li>
  );
}
