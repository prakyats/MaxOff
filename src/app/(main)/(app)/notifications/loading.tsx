import { PageHeader } from "@/core/ui/composites/page-header";
import { NotificationListSkeleton } from "@/modules/notifications-center";

import { AlertsFilter } from "./alerts-filter";

/**
 * Alerts' header, the "All | Unread" filter (nothing chosen yet), the "N unread" line, the first
 * day heading and the rows, traced (ARCHITECTURE §14.1).
 */
export default function Loading() {
  return (
    <>
      <PageHeader
        title="Alerts"
        description="Your notifications, each one a tap away from what it's about."
      />
      <AlertsFilter current={null} />
      <NotificationListSkeleton />
    </>
  );
}
