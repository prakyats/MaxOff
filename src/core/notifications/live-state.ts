import { drawnSince } from "@/core/lib/drawn-since";

/**
 * Whether the member's notifications changed since a screen was drawn (task 5.1). Back and
 * forward restore a screen from the router's history cache, never from the server, so a list
 * drawn before a row was read (a tap that opened it, Mark all read elsewhere, a Realtime event)
 * would come back with the row still unread. Every change bumps the version; `FreshOnReturn`
 * remembers the version each drawing first met, and re-reads the screen when it is shown again
 * after a change. Module state: one page's lifetime, no storage.
 */
const notifications = drawnSince();
let ownReadAt = Number.NEGATIVE_INFINITY;

/** Something about the member's notifications changed (a read, a new row). */
export function noteNotificationsChanged(): void {
  notifications.changed();
}

/**
 * Whether the drawing `renderId` is shown after a change it never met: its first showing records
 * the version, a later one compares.
 */
export function staleSinceDrawn(renderId: string): boolean {
  return notifications.staleSinceDrawn(renderId);
}

/**
 * The member's own read was sent or answered on this device (owner decision 2026-10-01): its
 * Realtime read receipts only confirm the bell's count (`readUnreadCount`), they never re-read
 * the screen (`OWN_READ_QUIET_MS`).
 */
export function noteOwnRead(nowMs: number): void {
  noteNotificationsChanged();
  ownReadAt = nowMs;
}

/** Whether an own read was sent or answered within the last `windowMs`. */
export function ownReadWithin(nowMs: number, windowMs: number): boolean {
  return nowMs - ownReadAt < windowMs;
}
