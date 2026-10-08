import "server-only";

import { z } from "zod";

import { systemClock } from "@/core/time";

import { readUnread, rpcMarkRecordRead } from "./inbox";
import { appReportSchema } from "./reachability";
import { rpcAppOpenReport } from "./reachability-store";
import type { ServerUnread } from "./read-receipts";
import { subscriptionSchema } from "./push/schemas";
import { rpcPushSubscriptionUpsert } from "./push/subscriptions";
import type { ReadWritten } from "./send-read";

/**
 * The notification area's **background calls** (ARCHITECTURE §4.4): what the app sends on its
 * own, served by route handlers under `/api/` (`core/http/background-route.ts`), never as server
 * actions, so none can hold a navigation. Each is zod → the database call, as the server action it
 * replaced; the route has already refused anyone who is not a signed-in active member, and RLS or
 * the RPC decides the rows. Nothing is revalidated: no answer re-renders a screen.
 */

/**
 * The app says what it is running on, once per open (task 5.4, owner decision 2026-10-03):
 * `POST /api/app-report`. The caller ignores a failure (the next open reports again).
 */
export async function reportAppOpen(input: unknown): Promise<null> {
  await rpcAppOpenReport(appReportSchema.parse(input));
  return null;
}

/**
 * This device's subscription, stored again (task 5.2, WORKFLOWS §9a): `POST
 * /api/push/subscription`, from `PushSync`'s automatic re-subscribe on load and from the service
 * worker's `pushsubscriptionchange` (no page open). A device the member removed from Me's list
 * is refused (INVALID_STATE, owner 2026-10-06): only their own "Turn on" tap (`turnOnPush`)
 * brings it back.
 */
export async function storeOwnSubscription(input: unknown): Promise<{ id: string }> {
  return { id: await rpcPushSubscriptionUpsert(subscriptionSchema.parse(input)) };
}

/**
 * The bell's count alone (`GET /api/notifications/unread`), for the live bell's first join and to
 * confirm the device's own reads (owner decision 2026-10-01). Read only.
 */
export async function readUnreadCount(): Promise<ServerUnread> {
  return readUnread();
}

/** The records a notification can be about, as `notifications.entity` names them. */
const RECORD_ENTITIES = ["tasks", "clients", "members", "projects"] as const;
const recordSchema = z.object({ entity: z.enum(RECORD_ENTITIES), id: z.uuid() });

/**
 * Opening a record marks the member's unread notifications about it read (kickoff 5 decision 4;
 * `notifications_mark_read`): `POST /api/notifications/read-record`, sent by the record page's
 * `MarkRecordRead`. A read is view state, not audited (DATA-MODEL §9). Answers how many rows it
 * marked and the server's clock just after the write (`read-receipts.ts`).
 */
export async function markRecordRead(input: unknown): Promise<ReadWritten> {
  const { entity, id } = recordSchema.parse(input);
  const marked = await rpcMarkRecordRead(entity, id);
  return { marked, writtenAt: systemClock().getTime() };
}
