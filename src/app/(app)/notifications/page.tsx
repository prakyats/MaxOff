import { BellIcon, CheckCheckIcon } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireMember } from "@/core/auth/server";
import { checkThenRead } from "@/core/lib/start-early";
import { INBOX_PAGE_SIZE, listInbox, readUnread } from "@/core/notifications/inbox";
import { todayIST } from "@/core/time";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { PageHeader } from "@/core/ui/composites/page-header";
import {
  alertsFilterFrom,
  alertsHref,
  NotificationBar,
  NotificationList,
  pageFrom,
} from "@/modules/notifications-center";
import { FreshOnReturn } from "@/modules/notifications-center/components/fresh-on-return";

import { AlertsFilter } from "./alerts-filter";
import { AlertsPager } from "./alerts-pager";

export const metadata: Metadata = { title: "Alerts" };

const DESCRIPTION = "Your notifications, each one a tap away from what it's about.";

/**
 * Alerts (task 5.1, kickoff 5 decision 4; 5B decision 10): every role's own notifications, newest
 * first, 20 entries at a time: the Staff bar's Alerts tab, the bell for the Owner and Admins. The
 * "All | Unread" filter, then "N unread" and "Mark all read", then the day groups (same-record
 * runs one row with a count), the pager below (only past one page, so nothing above the list
 * moves). The reads are the member's own (RLS), started with the session read (§19).
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { page: requested, show } = await searchParams;
  const page = pageFrom(requested);
  const filter = alertsFilterFrom(show);
  // The reads start with the session read; the member check is awaited first (§19).
  const [, [listing, unread]] = await checkThenRead(
    requireMember(),
    Promise.all([listInbox(page, filter === "unread"), readUnread()]),
  );
  const pages = Math.max(1, Math.ceil(listing.total / INBOX_PAGE_SIZE));
  // A page that no longer exists: the first one.
  if (page > pages) redirect(alertsHref(filter));

  return (
    <>
      <FreshOnReturn renderId={crypto.randomUUID()} />
      <PageHeader title="Alerts" description={DESCRIPTION} />
      <AlertsFilter current={filter} />
      {listing.total === 0 && filter === "all" ? (
        <EmptyState
          icon={BellIcon}
          title="Nothing yet"
          description="You'll get a note here when something needs you or one of your requests is decided."
        />
      ) : listing.total === 0 ? (
        <EmptyState
          icon={CheckCheckIcon}
          title="You're all caught up"
          description="No unread alerts. All shows the ones you've read."
        />
      ) : (
        <>
          <NotificationBar unread={unread} />
          <NotificationList rows={listing.rows} today={todayIST()} countedAt={unread.countedAt} />
          {pages > 1 ? (
            <AlertsPager
              label={`Page ${page} of ${pages}`}
              previous={page > 1 ? alertsHref(filter, page - 1) : null}
              next={page < pages ? alertsHref(filter, page + 1) : null}
            />
          ) : null}
        </>
      )}
    </>
  );
}
