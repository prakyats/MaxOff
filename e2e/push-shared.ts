import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { APIRequestContext } from "@playwright/test";

import { systemClock } from "../src/core/time";
import { expect } from "./fixtures";
import {
  rpcAs,
  serviceInsert,
  serviceRest,
  serviceSelect,
  serviceUpdate,
  taskTypeId,
  USERS,
} from "./helpers";

/**
 * What the Web Push specs share (push.spec.ts, push-cron.spec.ts, push-quiet.spec.ts): the fake
 * push service on the loopback host, the fixture person's password, the API shortcuts and the
 * one cron dispatch. The e2e server is allowed to POST to plain http on the loopback host only
 * through `PUSH_ALLOW_LOOPBACK_ENDPOINTS` (playwright.config.ts) and the database's local switch
 * (supabase/seed.sql, `app.local_flags`): 5A review M2.
 */
export const CRON_SECRET = process.env.CRON_SECRET ?? "e2e-only-cron-secret-not-used-anywhere-else";
export const PUSH_PASSWORD = "push-local-password";

export type Received = { path: string; authorization: string; encoding: string; body: Buffer };
export type Receiver = { privateKey: string; publicKey: string; auth: string };

/** The fake push service: 201 for `/ok/*`, 410 for `/gone/*`, 500 for `/down/*`. */
export function fakePushService(): Promise<{ server: Server; url: string; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({
        path: request.url ?? "",
        authorization: request.headers.authorization ?? "",
        encoding: String(request.headers["content-encoding"] ?? ""),
        body: Buffer.concat(chunks),
      });
      const status = request.url?.startsWith("/gone/")
        ? 410
        : request.url?.startsWith("/down/")
          ? 500
          : 201;
      response.writeHead(status).end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}`, received });
    });
  });
}

/** One run of the cron route, as the Worker's minute would make it. */
export async function runDispatch(
  request: APIRequestContext,
): Promise<{ claimed: number; sent: number }> {
  const response = await request.post("/api/cron/push-dispatch", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { claimed: number; sent: number };
}

/**
 * Owner decision 29: a dispatch spec owns the queue. Every push and email delivery still waiting
 * (other specs' rows: queued, or held by quiet hours) is closed as `failed` 'e2e_cleared', and
 * every recent notification with no email row yet gets one, closed the same way, so the email
 * pass cannot queue other specs' mail ahead of this spec's. After this, one dispatch handles
 * exactly the rows the spec makes. Runs only in the serial `push-cron` project, after every
 * other project (playwright.config.ts).
 */
export async function ownTheDispatchQueue(): Promise<void> {
  await serviceUpdate("notification_deliveries?state=in.(queued,held)", {
    state: "failed",
    last_error: "e2e_cleared",
  });
  // email_claim looks back 24 hours; anything newer without an email row could be queued.
  const since = new Date(systemClock().getTime() - 25 * 3600 * 1000).toISOString();
  const page = 1000;
  // Each pass closes what it found, so the next pass's anti-join starts again from the top.
  for (;;) {
    const rows = await serviceSelect<{ id: string }>(
      `notifications?select=id,notification_deliveries(id)&notification_deliveries.channel=eq.email&notification_deliveries=is.null&created_at=gt.${since}&order=id&limit=${page}`,
    );
    if (rows.length > 0) {
      await serviceRest("notification_deliveries?on_conflict=notification_id,channel", {
        method: "POST",
        headers: { prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify(
          rows.map((row) => ({
            notification_id: row.id,
            channel: "email",
            state: "failed",
            last_error: "e2e_cleared",
          })),
        ),
      });
    }
    if (rows.length < page) return;
  }
}

/** Quiet hours off (equal times mean no window, push_quiet); returns the restore. */
export async function noQuietHours(): Promise<() => Promise<void>> {
  const [row] = await serviceSelect<{
    org_id: string;
    quiet_hours_start: string;
    quiet_hours_end: string;
  }>("org_settings?select=org_id,quiet_hours_start,quiet_hours_end");
  expect(row, "one org_settings row").toBeTruthy();
  const { org_id, quiet_hours_start, quiet_hours_end } = row!;
  await serviceUpdate(`org_settings?org_id=eq.${org_id}`, {
    quiet_hours_start: "07:00",
    quiet_hours_end: "07:00",
  });
  return () =>
    serviceUpdate(`org_settings?org_id=eq.${org_id}`, { quiet_hours_start, quiet_hours_end });
}

/** A task the Owner assigns to this person (task_assigned), through the API. */
export async function assignTask(staffId: string, title: string): Promise<string> {
  return rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
    title,
    description: null,
    task_type_id: await taskTypeId("Normal"),
    client_id: null,
    priority: "medium",
    due_at: new Date(systemClock().getTime() + 3 * 24 * 3600 * 1000).toISOString(),
    assignee_ids: [staffId],
    primary_owner_id: staffId,
    approving_admin_id: null,
    stages: [],
  });
}

export type PushDelivery = {
  id: string;
  state: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
};

/** The push delivery of this person's row about a task. */
export async function pushDeliveryOf(staffId: string, taskId: string): Promise<PushDelivery> {
  const rows = await serviceSelect<PushDelivery>(
    `notification_deliveries?channel=eq.push&select=id,state,attempts,last_error,next_attempt_at,notifications!inner(recipient_id,entity_id)&notifications.recipient_id=eq.${staffId}&notifications.entity_id=eq.${taskId}`,
  );
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

/**
 * A device of this person at the fake push service, written as the service role: the API role
 * has no INSERT (5A review M2), and the browser's own subscribe is proved in push.spec.ts.
 */
export async function addDevice(
  staffId: string,
  endpoint: string,
  receiver: Receiver,
): Promise<string> {
  const row = await serviceInsert<{ id: string }>("push_subscriptions", {
    member_id: staffId,
    endpoint,
    p256dh: receiver.publicKey,
    auth: receiver.auth,
    platform: "android",
  });
  return row.id;
}
