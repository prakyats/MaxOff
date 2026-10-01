import { PageHeader } from "@/core/ui/composites/page-header";
import { NotificationListSkeleton } from "@/modules/notifications-center";

/** Alerts' header, the "N unread" line and the rows, traced (ARCHITECTURE §14.1). */
export default function Loading() {
  return (
    <>
      <PageHeader
        title="Alerts"
        description="Your notifications, each one a tap away from what it's about."
      />
      <NotificationListSkeleton />
    </>
  );
}
