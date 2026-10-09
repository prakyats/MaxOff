"use client";

import { useEffect, useRef } from "react";

import { postInBackground } from "@/core/http/background";
import { type ReadWritten, sendRead } from "@/core/notifications/send-read";

/**
 * Opening a record marks the viewer's unread notifications about it read (kickoff 5 decision 4):
 * drawn by `RecordReadReceipt` on a task's, a client's and a person's page when some are unread,
 * it sends the mark once per record, in the background. The `unread` rows come off the bell on
 * the device at once and nothing re-reads the page (owner decision 2026-10-01); a failed mark is
 * undone quietly by the server's next count and the rows stay unread for the next visit. A
 * **background call** (ARCHITECTURE §4.4): a plain request to `/api/notifications/read-record`,
 * never a server action, which would hold a navigation it went out during.
 */
export function MarkRecordRead({
  entity,
  id,
  unread,
}: {
  entity: "tasks" | "clients" | "members" | "projects";
  id: string;
  unread: number;
}): null {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    const record = `${entity}:${id}`;
    if (unread <= 0 || sent.current === record) return;
    sent.current = record;
    void sendRead(unread, [], () =>
      postInBackground<ReadWritten>("/api/notifications/read-record", { entity, id }),
    );
  }, [entity, id, unread]);
  return null;
}
