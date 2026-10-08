"use client";

import { useEffect, useSyncExternalStore } from "react";

import {
  readReceiptsVersion,
  type ServerUnread,
  serverUnreadSeen,
  subscribeReadReceipts,
  unreadShown,
} from "./read-receipts";

/** Re-renders the caller whenever this device's read receipts change. */
export function useReceipts(): void {
  useSyncExternalStore(subscribeReadReceipts, readReceiptsVersion, () => 0);
}

/**
 * The bell's count to draw from the server's `server`: less the reads this device has sent that
 * the count does not hold yet (owner decision 2026-10-01). The count is noted as the newest truth
 * the device has seen, so the receipts it already holds are let go.
 */
export function useUnreadShown(server: ServerUnread): number {
  useReceipts();
  const { count, countedAt } = server;
  useEffect(() => {
    serverUnreadSeen({ count, countedAt });
  }, [count, countedAt]);
  return unreadShown(server);
}
