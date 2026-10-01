/**
 * The member's read receipts on this device (owner decision 2026-10-01, PROGRESS Ideas (a)):
 * marking notifications read never refreshes or reloads the page. The read is written in the
 * background; the bell's count drops here as soon as it is issued; the server's next count
 * confirms it. Module state (one page's lifetime, no storage), kept pure so it is tested alone.
 *
 * A count from the server (`ServerUnread`) carries the server's clock when it was counted. A read
 * still in flight takes its rows off every count. A read the server wrote takes them off only
 * the counts made before it was written (a later count already leaves them out). A read that
 * failed takes them off only the counts already known when it failed, so the next count from the
 * server restores them quietly: no toast, no reload.
 */

/** The member's unread notifications as the server counted them, at `countedAt` (server ms). */
export interface ServerUnread {
  count: number;
  countedAt: number;
}

/** Which rows a read is about: some rows by id, or every row (Mark all read). */
type ReadRows = readonly string[] | "all";

type Receipt =
  | { state: "pending"; delta: number; rows: ReadRows }
  | { state: "written"; delta: number; rows: ReadRows; writtenAt: number }
  | { state: "failed"; delta: number; rows: ReadRows; failedAfter: number };

const receipts = new Map<number, Receipt>();
let nextToken = 1;
let latest: ServerUnread | null = null;
let version = 0;
const listeners = new Set<() => void>();

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** Whether a receipt still takes its rows off a count made at `countedAt`. */
function applies(receipt: Receipt, countedAt: number): boolean {
  if (receipt.state === "written") return receipt.writtenAt > countedAt;
  return receipt.state === "pending" || countedAt <= receipt.failedAfter;
}

/** The newer of a count drawn by the server and the newest one this device has seen. */
function freshest(server: ServerUnread): ServerUnread {
  return latest && latest.countedAt > server.countedAt ? latest : server;
}

/** Drops the receipts the newest count no longer needs. */
function settle(): void {
  if (!latest) return;
  for (const [token, receipt] of receipts) {
    if (!applies(receipt, latest.countedAt)) receipts.delete(token);
  }
}

/**
 * A read is sent: `delta` rows come off the count at once (`Infinity` for Mark all read until
 * the server says how many), and `rows` show as read. Returns the token its answer is given with.
 */
export function readIssued(delta: number, rows: ReadRows): number {
  const token = nextToken;
  nextToken += 1;
  receipts.set(token, { state: "pending", delta: Math.max(0, delta), rows });
  changed();
  return token;
}

/** The server wrote the read at `writtenAt` (server ms), marking `marked` rows. */
export function readWritten(token: number, marked: number, writtenAt: number): void {
  const receipt = receipts.get(token);
  if (!receipt) return;
  receipts.set(token, {
    state: "written",
    delta: Math.max(0, marked),
    rows: receipt.rows,
    writtenAt,
  });
  settle();
  changed();
}

/** The read did not reach the server, or the server refused it: undone by the next count. */
export function readFailed(token: number): void {
  const receipt = receipts.get(token);
  if (!receipt) return;
  receipts.set(token, {
    state: "failed",
    delta: receipt.delta,
    rows: receipt.rows,
    failedAfter: latest?.countedAt ?? Number.NEGATIVE_INFINITY,
  });
  changed();
}

/** A count from the server reached this device (a render of the layout, a confirmation). */
export function serverUnreadSeen(server: ServerUnread): void {
  if (latest && latest.countedAt >= server.countedAt) return;
  latest = server;
  settle();
  changed();
}

/** The count to show, given the one the server drew: its newest truth less what is in flight. */
export function unreadShown(server: ServerUnread): number {
  const base = freshest(server);
  let off = 0;
  for (const receipt of receipts.values()) {
    if (applies(receipt, base.countedAt)) off += receipt.delta;
  }
  return Math.max(0, base.count - off);
}

/** Whether a row drawn unread in a list counted at `countedAt` shows as read on this device. */
export function rowReadShown(id: string, countedAt: number): boolean {
  for (const receipt of receipts.values()) {
    if (!applies(receipt, countedAt)) continue;
    if (receipt.rows === "all" || receipt.rows.includes(id)) return true;
  }
  return false;
}

/** Whether a read of this device is in flight (its Realtime echoes need no refresh). */
export function readInFlight(): boolean {
  for (const receipt of receipts.values()) {
    if (receipt.state === "pending") return true;
  }
  return false;
}

/** Whether a read of this device still waits for a count from the server that holds it. */
export function readsUnconfirmed(): boolean {
  return receipts.size > 0;
}

/** For `useSyncExternalStore`: a number that changes whenever anything above does. */
export function readReceiptsVersion(): number {
  return version;
}

export function subscribeReadReceipts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only: a fresh page. */
export function resetReadReceipts(): void {
  receipts.clear();
  nextToken = 1;
  latest = null;
  version = 0;
}
