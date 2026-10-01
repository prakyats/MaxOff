"use client";

import { rowReadShown } from "./read-receipts";
import { useReceipts } from "./use-unread";

/**
 * Whether a row the server drew unread (in a list counted at `countedAt`) shows as read on this
 * device (owner decision 2026-10-01). Apart from `use-unread.ts`, which every screen's bell loads.
 */
export function useRowReadShown(id: string, countedAt: number): boolean {
  useReceipts();
  return rowReadShown(id, countedAt);
}
