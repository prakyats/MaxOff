import { BellIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { InboxRow } from "@/core/notifications/inbox";
import type { ServerUnread } from "@/core/notifications/read-receipts";
import { cn } from "@/core/lib/utils";
import { PersonAvatar } from "@/core/ui/composites/person-avatar";
import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "@/core/ui/composites/row-metrics";
import { openNotificationUrl } from "@/core/ui/navigation/deep-link";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { entryTitle, groupByDay } from "../domain/alerts";
import { notificationWhen, twelveHourTimes } from "../domain/when";
import { NotificationLink } from "./notification-link";
import { NotificationReadButton } from "./notification-read-button";
import { NotificationRow } from "./notification-row";
import { UnreadSummary } from "./unread-summary";

/**
 * The bell's history (task 5.1, kickoff 5 decision 4; 5B decision 10): newest first, under day
 * headings (Today, Yesterday, Earlier this week, Older; IST), consecutive notifications about the
 * same record one row with a count ("3 comments on Edit"; `notifications_inbox_page`), one
 * continuous list ("Show older" at its foot, `AlertsFeed`; V5b-D). An unread row sits one surface
 * lighter with a red dot and a bold title; the actor's photo leads every row (V5b-D, the approved
 * pull-in sample). A row with a link opens
 * it through the deep-link entry (`/open?n=<id>`: marked read, the record with its parent list
 * underneath, ARCHITECTURE §14.2 h); a row with nothing to open is read by a tap. Drawn on the
 * server first (`AlertsFeed` renders it): the rows are plain links and work before hydration. A read shows at once on the
 * device (`NotificationRow`, `UnreadSummary`) and never re-reads the page (owner decision
 * 2026-10-01). `unread` / `countedAt` are the server's count and when it was counted.
 */

const ROW = "flex min-h-16 w-full min-w-0 items-start gap-3 px-4 py-3 text-left";
/** The unread dot's slot: always its width, so read and unread rows line up (V5b-D). */
const DOT_SLOT = "flex h-7 w-[7px] shrink-0 items-center";
/** How many rows load their photo at once; the rest when scrolled to. */
const EAGER_ROWS = 6;
const LIST =
  "border-border divide-border bg-card shadow-raised divide-y overflow-hidden rounded-lg border";
/** A day group's heading: one fixed line above its card. */
const HEADING =
  "text-muted-foreground mb-2 h-5 text-xs leading-5 font-semibold tracking-wide uppercase";
/** The space between two day groups. */
const GROUP = "not-first:mt-5";
/** The line above the list: how many are unread, and "Mark all read". */
const BAR = "mb-3 flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1";

export function NotificationBar({ unread }: { unread: ServerUnread }) {
  return (
    <div data-slot="notification-bar" className={BAR}>
      <UnreadSummary unread={unread} />
    </div>
  );
}

export function NotificationList({
  rows,
  today,
  countedAt,
}: {
  rows: InboxRow[];
  today: string;
  countedAt: number;
}) {
  return (
    <div data-slot="notification-rows">
      {groupByDay(rows, today).map(({ group, label, rows: groupRows }) => (
        <section
          key={group}
          aria-labelledby={`alerts-${group}`}
          data-slot="notification-group"
          data-group={group}
          className={GROUP}
        >
          <h2 id={`alerts-${group}`} className={HEADING}>
            {label}
          </h2>
          <ul aria-label={`Alerts: ${label}`} className={LIST}>
            {groupRows.map((row) => (
              <NotificationRow
                key={row.id}
                id={row.id}
                unread={row.runUnread.length > 0}
                countedAt={countedAt}
                runSize={row.runSize}
              >
                <NotificationTarget row={row}>
                  <RowContent row={row} today={today} eager={rows.indexOf(row) < EAGER_ROWS} />
                </NotificationTarget>
              </NotificationRow>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function NotificationTarget({ row, children }: { row: InboxRow; children: ReactNode }) {
  if (row.link) {
    return (
      <NotificationLink href={openNotificationUrl(row.id, row.runSize > 1)} className={ROW}>
        {children}
      </NotificationLink>
    );
  }
  if (row.runUnread.length > 0) {
    // Once read on the device it stays a button for the moment the page holds it: a second tap
    // writes nothing (the server marks only an unread row).
    return (
      <NotificationReadButton id={row.id} className={ROW}>
        {children}
      </NotificationReadButton>
    );
  }
  return <div className={ROW}>{children}</div>;
}

function RowContent({ row, today, eager }: { row: InboxRow; today: string; eager: boolean }) {
  // Unread is the row's `data-unread` (`NotificationRow`): the dot and the bold title follow a
  // read made on the device without the page being drawn again.
  const unread = row.runUnread.length > 0;
  const { title, count } = entryTitle(row);
  return (
    <>
      <span className={DOT_SLOT}>
        {unread ? (
          <span className="hidden group-data-[unread]/row:flex">
            <span className="bg-danger size-[7px] rounded-full" aria-hidden />
            <span className="sr-only">Unread: </span>
          </span>
        ) : null}
      </span>
      <ActorAvatar actor={row.actor} eager={eager} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <span
            className={cn("min-w-0 text-sm break-words", CARD_ROW_TITLE)}
            data-slot="notification-title"
          >
            <span className="min-w-0 font-medium group-data-[unread]/row:font-semibold">
              {twelveHourTimes(title)}
            </span>
          </span>
          <span className={cn("flex items-center gap-2", CARD_ROW_TRAILING)}>
            {count ? (
              // The run's size: the row opens the record, where every one of them is.
              <span
                data-slot="notification-count"
                className="bg-muted text-foreground inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs leading-5 font-medium tabular-nums"
              >
                {count}
                <span className="sr-only"> alerts about this</span>
              </span>
            ) : null}
            <time
              dateTime={row.createdAt}
              className="text-muted-foreground text-xs leading-5 tabular-nums"
            >
              {notificationWhen(row.createdAt, today)}
            </time>
          </span>
        </span>
        {row.body ? (
          <span
            className="text-muted-foreground line-clamp-3 text-xs break-words"
            data-slot="notification-body"
          >
            {twelveHourTimes(row.body)}
          </span>
        ) : null}
      </span>
    </>
  );
}

/**
 * Who caused it (V5b-D): their photo, or their initials, when the viewer's directory names them;
 * a quiet bell for a job's alert and for someone the viewer's directory does not show.
 */
function ActorAvatar({ actor, eager }: { actor: InboxRow["actor"]; eager: boolean }) {
  if (actor?.name) {
    return (
      <PersonAvatar
        person={{ id: actor.id, name: actor.name, avatarFileId: actor.avatarFileId }}
        size={28}
        eager={eager}
        className="mt-0.5"
      />
    );
  }
  return (
    <span
      data-slot="person-avatar"
      data-size={28}
      data-tone="none"
      aria-hidden
      className="relative mt-0.5 inline-grid shrink-0 place-items-center rounded-full"
    >
      <BellIcon className="size-3.5" />
    </span>
  );
}

/**
 * The list's loading state, a tracing of it (ARCHITECTURE §14.1): the bar's line, the first day
 * heading, then rows of the rows' own height with the dot's slot, the photo, a title, the time and
 * a line of body.
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
      <div aria-hidden className={HEADING}>
        <span className="flex h-5 items-center">
          <Skeleton className="h-3 w-12" />
        </span>
      </div>
      <ul aria-hidden className={LIST}>
        {Array.from({ length: rows }, (_, index) => (
          <li key={index} className={ROW}>
            <span className={DOT_SLOT} />
            <Skeleton className="mt-0.5 size-7 shrink-0 rounded-full" />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
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
            </span>
          </li>
        ))}
      </ul>
      <span className="sr-only">Loading your alerts</span>
    </div>
  );
}
