import { BellIcon } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireMember } from "@/core/auth/server";
import { checkThenRead } from "@/core/lib/start-early";
import { countUnread, INBOX_PAGE_SIZE, listInbox } from "@/core/notifications/inbox";
import { todayIST } from "@/core/time";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { PageHeader } from "@/core/ui/composites/page-header";
import { NotificationBar, NotificationList, pageFrom } from "@/modules/notifications-center";
import { FreshOnReturn } from "@/modules/notifications-center/components/fresh-on-return";

import { AlertsPager } from "./alerts-pager";

export const metadata: Metadata = { title: "Alerts" };

const DESCRIPTION = "Your notifications, each one a tap away from what it's about.";

/**
 * Alerts (task 5.1, kickoff 5 decision 4; owner cut (b)): every role's own notifications, newest
 * first, 20 at a time: the Staff bar's Alerts tab, the bell for the Owner and Admins. "N unread"
 * and "Mark all read" above the list, the pager below it (only past one page, so nothing above the
 * list moves). Nothing is purged. The reads are the member's own (RLS), started with the session
 * read (§19).
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { page: requested } = await searchParams;
  const page = pageFrom(requested);
  // The reads start with the session read; the member check is awaited first (§19).
  const [, [listing, unread]] = await checkThenRead(
    requireMember(),
    Promise.all([listInbox(page), countUnread()]),
  );
  const pages = Math.max(1, Math.ceil(listing.total / INBOX_PAGE_SIZE));
  // A page that no longer exists: the first one.
  if (page > pages) redirect("/notifications");

  return (
    <>
      <FreshOnReturn renderId={crypto.randomUUID()} />
      <PageHeader title="Alerts" description={DESCRIPTION} />
      {listing.total === 0 ? (
        <EmptyState
          icon={BellIcon}
          title="Nothing yet"
          description="You'll get a note here when something needs you or one of your requests is decided."
        />
      ) : (
        <>
          <NotificationBar unread={unread} />
          <NotificationList rows={listing.rows} today={todayIST()} />
          {pages > 1 ? (
            <AlertsPager
              label={`Page ${page} of ${pages}`}
              previous={
                page > 1
                  ? page === 2
                    ? "/notifications"
                    : `/notifications?page=${page - 1}`
                  : null
              }
              next={page < pages ? `/notifications?page=${page + 1}` : null}
            />
          ) : null}
        </>
      )}
    </>
  );
}
