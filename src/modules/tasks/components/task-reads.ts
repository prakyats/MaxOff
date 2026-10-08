import { drawnSince } from "@/core/lib/drawn-since";

/**
 * Chat read on this device (Kickoff 4 decision 28): the task lists' unread markers (the Tasks
 * tab, all tasks, Approvals) were drawn before it. `markTaskRead` revalidates nothing (owner
 * decision 2026-10-01: a read never re-reads the page it is made on), so a list shown again from
 * the router's history cache re-reads itself instead (`TasksFreshOnReturn`).
 */
export const taskReads = drawnSince();
