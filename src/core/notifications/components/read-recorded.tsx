"use client";

import { useEffect, useRef } from "react";

import { noteNotificationsChanged } from "../live-state";
import { readIssued, readWritten } from "../read-receipts";

/**
 * The deep-link entry marked a row of the bell's history read while it was drawn (`/open?n=`):
 * the bell drops on the device as the entry opens (owner decision 2026-10-01), until the server's
 * next count holds it. Once per entry.
 */
export function ReadRecorded({ id, writtenAt }: { id: string; writtenAt: number }): null {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    noteNotificationsChanged();
    readWritten(readIssued(1, [id]), 1, writtenAt);
  }, [id, writtenAt]);
  return null;
}
