"use client";

import { useEffect, useRef } from "react";

import { noteNotificationsChanged } from "../live-state";
import { readIssued, readWritten } from "../read-receipts";

/**
 * The deep-link entry marked a row of the bell's history read while it was drawn (`/open?n=`):
 * the bell drops on the device as the entry opens (owner decision 2026-10-01), until the server's
 * next count holds it. Once per entry. `marked`: how many it read (more than one for a row that
 * held a run about one record, 5B decision 10).
 */
export function ReadRecorded({
  id,
  marked = 1,
  writtenAt,
}: {
  id: string;
  marked?: number;
  writtenAt: number;
}): null {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    noteNotificationsChanged();
    readWritten(readIssued(marked, [id]), marked, writtenAt);
  }, [id, marked, writtenAt]);
  return null;
}
