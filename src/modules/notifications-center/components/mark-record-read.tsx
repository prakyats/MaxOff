"use client";

import { useEffect } from "react";

import { noteOwnReadRevalidated } from "@/core/notifications/live-state";
import { systemClock } from "@/core/time/clock";

import { markRecordRead } from "../actions/inbox";

/**
 * Opening a record marks the viewer's unread notifications about it read (kickoff 5 decision 4):
 * mounted on a task's, a client's and a person's page, it sends the mark once per record, in the
 * background. A failed mark leaves the rows unread for the next visit; nothing to retry.
 */
export function MarkRecordRead({
  entity,
  id,
}: {
  entity: "tasks" | "clients" | "members";
  id: string;
}): null {
  useEffect(() => {
    markRecordRead({ entity, id })
      .then((result) => {
        if (result.ok && result.data.marked > 0) noteOwnReadRevalidated(systemClock().getTime());
      })
      .catch(() => undefined);
  }, [entity, id]);
  return null;
}
