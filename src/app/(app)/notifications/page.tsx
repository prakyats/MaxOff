import { BellIcon, CheckCheckIcon } from "lucide-react";
import type { Metadata } from "next";

import { requireMember } from "@/core/auth/server";
import { checkThenRead } from "@/core/lib/start-early";
import { listInboxPage, readUnread } from "@/core/notifications/inbox";
import { todayIST } from "@/core/time";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { PageHeader } from "@/core/ui/composites/page-header";
import { alertsFilterFrom, NotificationBar } from "@/modules/notifications-center";
import { AlertsFeed } from "@/modules/notifications-center/components/alerts-feed";
import { FreshOnReturn } from "@/modules/notifications-center/components/fresh-on-return";

import { AlertsFilter } from "./alerts-filter";

export const metadata: Metadata = { title: "Alerts" };

const DESCRIPTION = "Your notifications, each one a tap away from what it's about.";

/**
 * Alerts (task 5.1, kickoff 5 decision 4; 5B decision 10; V5b-D): every role's own notifications,
 * newest first, as **one continuous list**: the Staff bar's Alerts tab, the bell for the Owner and
 * Admins. The "All | Unread" filter, then "N unread" and "Mark all read", then the day groups
 * (same-record runs one row with a count, the actor's photo leading each row), and "Show older"
 * at the foot (keyset pages, `AlertsFeed`), so nothing above it moves. The reads are the member's
 * own (RLS), started with the session read (§19).
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { show } = await searchParams;
  const filter = alertsFilterFrom(show);
  // The reads start with the session read; the member check is awaited first (§19).
  const [, [listing, unread]] = await checkThenRead(
    requireMember(),
    Promise.all([listInboxPage({ unreadOnly: filter === "unread" }), readUnread()]),
  );
  // One drawing of the list: a server render (a filter, a refresh) starts it from the newest.
  const renderId = crypto.randomUUID();

  return (
    <>
      <FreshOnReturn renderId={renderId} />
      <PageHeader title="Alerts" description={DESCRIPTION} />
      <AlertsFilter current={filter} />
      {listing.rows.length === 0 && filter === "all" ? (
        <EmptyState
          icon={BellIcon}
          title="Nothing yet"
          description="You'll get a note here when something needs you or one of your requests is decided."
        />
      ) : listing.rows.length === 0 ? (
        <EmptyState
          icon={CheckCheckIcon}
          title="You're all caught up"
          description="No unread alerts. All shows the ones you've read."
        />
      ) : (
        <>
          <NotificationBar unread={unread} />
          <AlertsFeed
            key={renderId}
            rows={listing.rows}
            next={listing.next}
            unreadOnly={filter === "unread"}
            today={todayIST()}
            countedAt={unread.countedAt}
          />
        </>
      )}
    </>
  );
}
