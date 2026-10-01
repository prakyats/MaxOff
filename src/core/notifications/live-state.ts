/**
 * Whether the member's notifications changed since a screen was drawn (task 5.1). Back and
 * forward restore a screen from the router's history cache, never from the server, so a list
 * drawn before a row was read (a tap that opened it, Mark all read elsewhere, a Realtime event)
 * would come back with the row still unread. Every change bumps the version; `FreshOnReturn`
 * remembers the version each drawing first met, and re-reads the screen when it is shown again
 * after a change. Module state: one page's lifetime, no storage.
 */
let version = 0;
const seen = new Map<string, number>();
let ownReadAt = Number.NEGATIVE_INFINITY;

/** Something about the member's notifications changed (a read, a new row). */
export function noteNotificationsChanged(): void {
  version += 1;
}

/**
 * Whether the drawing `renderId` is shown after a change it never met: its first showing records
 * the version, a later one compares.
 */
export function staleSinceDrawn(renderId: string): boolean {
  const first = seen.get(renderId);
  if (first === undefined) {
    seen.set(renderId, version);
    return false;
  }
  if (first === version) return false;
  seen.set(renderId, version);
  return true;
}

/**
 * The member's own read action has just answered and re-read the screen itself (it revalidated):
 * the live bell need not refresh again for the UPDATE events it caused (`OWN_READ_QUIET_MS`).
 */
export function noteOwnReadRevalidated(nowMs: number): void {
  noteNotificationsChanged();
  ownReadAt = nowMs;
}

/** Whether an own read re-read the screen within the last `windowMs`. */
export function ownReadWithin(nowMs: number, windowMs: number): boolean {
  return nowMs - ownReadAt < windowMs;
}
