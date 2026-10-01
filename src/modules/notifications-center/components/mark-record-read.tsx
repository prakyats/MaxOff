"use client";

import { useEffect } from "react";

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
    markRecordRead({ entity, id }).catch(() => undefined);
  }, [entity, id]);
  return null;
}
