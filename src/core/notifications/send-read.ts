import type { Result } from "@/core/errors";
import { systemClock } from "@/core/time/clock";

import { noteOwnRead } from "./live-state";
import { readFailed, readIssued, readWritten } from "./read-receipts";

/** What a read action answers: how many rows it marked, and when (server ms). */
export interface ReadWritten {
  marked: number;
  writtenAt: number;
}

/**
 * Sends one of the member's reads in the background (owner decision 2026-10-01): the rows come off
 * the bell's count on this device at once, the write goes to the server, and nothing re-reads or
 * reloads the page. A refused or unreachable write is undone quietly by the server's next count:
 * no toast, nothing to retry. Resolves (never rejects) with whether the server wrote it.
 */
export function sendRead(
  delta: number,
  rows: readonly string[] | "all",
  write: () => Promise<Result<ReadWritten>>,
): Promise<boolean> {
  noteOwnRead(systemClock().getTime());
  const token = readIssued(delta, rows);
  return write()
    .then((result) => {
      if (!result.ok) {
        readFailed(token);
        return false;
      }
      noteOwnRead(systemClock().getTime());
      readWritten(token, result.data.marked, result.data.writtenAt);
      return true;
    })
    .catch(() => {
      readFailed(token);
      return false;
    });
}
