/**
 * modules/notifications-center: the bell's history screen (task 5.1, ARCHITECTURE §3.2). The
 * notifications themselves, their reads and the count are `core/notifications` (the area that owns
 * the tables); this module draws them. Client components are not exported here: a route imports
 * them one file at a time from `components/` (ADR-0011 amendment).
 */
export {
  NotificationBar,
  NotificationList,
  NotificationListSkeleton,
} from "./components/notification-list";
export { RecordReadReceipt } from "./components/record-read-receipt";
export { type AlertsFilter, alertsFilterFrom, alertsHref } from "./domain/alerts";
export { pageFrom } from "./domain/when";
