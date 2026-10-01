"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { taskReads } from "./task-reads";

/**
 * A task list shown again from the router's history cache (back from a task) after Chat was read
 * on this device is re-read in place (`router.refresh()`), so its unread markers follow the read.
 * `renderId` names this drawing of the list (one per server render).
 */
export function TasksFreshOnReturn({ renderId }: { renderId: string }): null {
  const router = useRouter();
  useEffect(() => {
    if (taskReads.staleSinceDrawn(renderId)) router.refresh();
  }, [renderId, router]);
  return null;
}
