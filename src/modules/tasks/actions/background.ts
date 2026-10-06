import "server-only";

import { assertPermission } from "@/core/permissions/server";

import * as repo from "../data/tasks";
import { availabilitySchema, markReadSchema } from "../domain/schemas";
import type { AvailabilityDay } from "../domain/warnings";

/**
 * The tasks module's **background calls** (ARCHITECTURE §4.4). Not server actions: plain server
 * functions behind route handlers (`/api/tasks/*`), which the app reaches with `fetch`, because
 * these go out on their own (an effect, a debounce timer) and a server action sent during a
 * navigation holds the new page until it answers. Each is the action it replaced: zod →
 * `assertPermission()` → the repository; nothing is revalidated.
 */

/**
 * The warning check (4.3), `GET /api/tasks/availability`: availability of the people picked on the
 * deadline's and the event's days, read while the create or edit dialog is open.
 */
export async function readAvailability(input: unknown): Promise<AvailabilityDay[]> {
  const data = availabilitySchema.parse(input);
  // The permission `member_availability()` itself checks (PERMISSIONS §1; 4B review S4).
  await assertPermission("availability.view");
  return repo.availability(data.days, data.memberIds);
}

/**
 * Having Chat in front of you marks its comments read (Kickoff 4 decision 28; `task_mark_read`,
 * the viewer's own row), `POST /api/tasks/read`. **Nothing is revalidated** (owner decision
 * 2026-10-01): the task page already shows the count gone; the lists' unread markers follow on
 * their next render, and a list shown again from the router's cache re-reads itself
 * (`TasksFreshOnReturn`).
 */
export async function markTaskRead(input: unknown): Promise<null> {
  const data = markReadSchema.parse(input);
  await assertPermission("tasks.work");
  await repo.rpcMarkRead(data.taskId, data.upTo);
  return null;
}
