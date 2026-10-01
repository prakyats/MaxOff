import type { ReactNode } from "react";

import type { InboxRow } from "@/core/notifications/inbox";
import { cn } from "@/core/lib/utils";
import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "@/core/ui/composites/row-metrics";
import { openNotificationUrl } from "@/core/ui/navigation/deep-link";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { notificationWhen } from "../domain/when";
import { MarkAllRead } from "./mark-all-read";
import { NotificationLink } from "./notification-link";
import { NotificationReadButton } from "./notification-read-button";

/**
 * The bell's history (task 5.1, kickoff 5 decision 4; owner cut (b), the simplest form): a plain
 * list, newest first. An unread row is marked by a dot and a bold title. A row with a link opens
 * it through the deep-link entry (`/open?n=<id>`: marked read, the record with its parent list
 * underneath, ARCHITECTURE §14.2 h); a row with nothing to open is read by a tap. Server
 * components: the rows are plain links and work before hydration.
 */

const ROW = "flex min-h-16 w-full min-w-0 flex-col gap-1 px-4 py-3 text-left";
const LIST = "border-border divide-border bg-card divide-y overflow-hidden rounded-lg border";
/** The line above the list: how many are unread, and "Mark all read". */
const BAR = "mb-3 flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1";

export function NotificationBar({ unread }: { unread: number }) {
  return (
    <div data-slot="notification-bar" className={BAR}>
      <p className="text-muted-foreground min-w-0 text-sm" aria-live="polite">
        {unread === 0 ? "All read" : `${unread} unread`}
      </p>
      {unread > 0 ? <MarkAllRead /> : null}
    </div>
  );
}

export function NotificationList({ rows, today }: { rows: InboxRow[]; today: string }) {
  return (
    <ul aria-label="Your alerts" data-slot="notification-rows" className={LIST}>
      {rows.map((row) => (
        <li
          key={row.id}
          data-slot="notification-row"
          data-notification={row.id}
          data-unread={row.readAt === null ? "true" : undefined}
        >
          <NotificationTarget row={row}>
            <RowContent row={row} today={today} />
          </NotificationTarget>
        </li>
      ))}
    </ul>
  );
}

function NotificationTarget({ row, children }: { row: InboxRow; children: ReactNode }) {
  if (row.link) {
    return (
      <NotificationLink
        href={openNotificationUrl(row.id)}
        className={cn(
          ROW,
          "pressable-row focus-visible:ring-ring outline-none focus-visible:ring-2 focus-visible:ring-inset",
        )}
      >
        {children}
      </NotificationLink>
    );
  }
  if (row.readAt === null) {
    return (
      <NotificationReadButton id={row.id} className={ROW}>
        {children}
      </NotificationReadButton>
    );
  }
  return <div className={ROW}>{children}</div>;
}

function RowContent({ row, today }: { row: InboxRow; today: string }) {
  const unread = row.readAt === null;
  return (
    <>
      <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <span
          className={cn("flex items-start gap-2 text-sm break-words", CARD_ROW_TITLE)}
          data-slot="notification-title"
        >
          {unread ? (
            <span className="flex h-5 shrink-0 items-center">
              <span className="bg-foreground size-2 rounded-full" aria-hidden />
              <span className="sr-only">Unread: </span>
            </span>
          ) : null}
          <span className={cn("min-w-0", unread ? "font-semibold" : "font-medium")}>
            {row.title}
          </span>
        </span>
        <time
          dateTime={row.createdAt}
          className={cn("text-muted-foreground text-xs leading-5 tabular-nums", CARD_ROW_TRAILING)}
        >
          {notificationWhen(row.createdAt, today)}
        </time>
      </span>
      {row.body ? (
        <span
          className="text-muted-foreground line-clamp-3 text-xs break-words"
          data-slot="notification-body"
        >
          {row.body}
        </span>
      ) : null}
    </>
  );
}

/**
 * The screen's loading state, a tracing of it (ARCHITECTURE §14.1): the bar's line, then rows of
 * the rows' own height with a title, the time and a line of body.
 */
export function NotificationListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div
      data-slot="loading-notifications"
      role="status"
      aria-busy="true"
      aria-label="Loading your alerts"
    >
      <div className={BAR}>
        <span className="flex h-5 min-w-0 items-center">
          <Skeleton className="h-4 w-20" />
        </span>
      </div>
      <ul aria-hidden className={LIST}>
        {Array.from({ length: rows }, (_, index) => (
          <li key={index} className={ROW}>
            <span className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <span className={cn("flex h-5 min-w-0 items-center", CARD_ROW_TITLE)}>
                <Skeleton className="h-4 w-48 max-w-full" />
              </span>
              <span className={cn("flex h-5 items-center", CARD_ROW_TRAILING)}>
                <Skeleton className="h-3 w-14" />
              </span>
            </span>
            <span className="flex h-4 min-w-0 items-center">
              <Skeleton className="h-3 w-60 max-w-full" />
            </span>
          </li>
        ))}
      </ul>
      <span className="sr-only">Loading your alerts</span>
    </div>
  );
}
