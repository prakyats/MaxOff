import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { decryptPayload, generateReceiverKeys } from "../src/core/notifications/push/encrypt";
import { systemClock, toISTTime } from "../src/core/time";
import { expect, test } from "./fixtures";
import {
  memberIdOf,
  rpcAs,
  serviceDelete,
  serviceInsert,
  serviceSelect,
  serviceUpdate,
  taskTypeId,
  USERS,
} from "./helpers";

/**
 * Quiet hours (kickoff 5 decision 5, WORKFLOWS §9a) through the real cron route: push rows due
 * inside the window are held, and the first run after the window's end sends one summary push
 * per person ("N updates while you were away", opening the history). The window is the
 * organisation's, so this spec runs in the `owner-bulk` project, alone, after every other
 * project (playwright.config.ts): moving it can never hold another spec's push. The clock is
 * never faked: the window is moved around the real time instead (07:00 IST is only its default
 * end). The device is a fake push service on the loopback host, as in push.spec.ts.
 */
const CRON_SECRET = process.env.CRON_SECRET ?? "e2e-only-cron-secret-not-used-anywhere-else";
const PERSON = "push-desktop@maxoff.local";

type Received = { path: string; body: Buffer };

function fakePushService(): Promise<{ server: Server; url: string; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({ path: request.url ?? "", body: Buffer.concat(chunks) });
      response.writeHead(201).end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}`, received });
    });
  });
}

/** The IST wall time `minutes` from now, as the org_settings time columns take it. */
function istIn(minutes: number): string {
  return toISTTime(new Date(systemClock().getTime() + minutes * 60_000));
}

test.describe("quiet hours hold push and release one summary", () => {
  test("held inside the window; the first run after it sends one summary per person", async ({
    request,
  }) => {
    const service = await fakePushService();
    const receiver = await generateReceiverKeys();
    const [settings] = await serviceSelect<{
      org_id: string;
      quiet_hours_start: string;
      quiet_hours_end: string;
    }>("org_settings?select=org_id,quiet_hours_start,quiet_hours_end");
    const staffId = await memberIdOf(PERSON);
    const dispatch = async () => {
      const response = await request.post("/api/cron/push-dispatch", {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      });
      expect(response.ok()).toBe(true);
      return (await response.json()) as { claimed: number };
    };
    try {
      await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
      await serviceInsert("push_subscriptions", {
        member_id: staffId,
        endpoint: `${service.url}/ok/quiet`,
        p256dh: receiver.publicKey,
        auth: receiver.auth,
        platform: "android",
      });
      // Inside the window: an hour either side of now.
      await serviceUpdate(`org_settings?org_id=eq.${settings!.org_id}`, {
        quiet_hours_start: istIn(-60),
        quiet_hours_end: istIn(60),
      });
      const stamp = systemClock().getTime();
      const titles = [`Quiet one ${stamp}`, `Quiet two ${stamp}`];
      const taskIds: string[] = [];
      for (const title of titles) {
        taskIds.push(
          await rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
            title,
            description: null,
            task_type_id: await taskTypeId("Normal"),
            client_id: null,
            priority: "medium",
            due_at: new Date(stamp + 3 * 24 * 3600 * 1000).toISOString(),
            assignee_ids: [staffId],
            primary_owner_id: staffId,
            approving_admin_id: null,
            stages: [],
          }),
        );
      }
      const pushStates = async () =>
        (
          await serviceSelect<{ state: string }>(
            `notification_deliveries?channel=eq.push&select=state,notifications!inner(recipient_id,entity_id)&notifications.recipient_id=eq.${staffId}&notifications.entity_id=in.(${taskIds.join(",")})`,
          )
        ).map((row) => row.state);

      // Every run inside the window holds them; nothing reaches the device. The rows themselves
      // are in the history at once (decision 5: only push waits).
      await dispatch();
      expect(await pushStates()).toEqual(["held", "held"]);
      expect(service.received).toHaveLength(0);
      const rows = await serviceSelect<{ id: string }>(
        `notifications?recipient_id=eq.${staffId}&entity_id=in.(${taskIds.join(",")})&select=id`,
      );
      expect(rows).toHaveLength(2);
      // Email is never held: task assigned is always emailed, in the window too (recorded
      // not_configured here: the e2e server has no RESEND_API_KEY).
      const mails = await serviceSelect<{ state: string; last_error: string | null }>(
        `notification_deliveries?channel=eq.email&select=state,last_error,notifications!inner(recipient_id,entity_id)&notifications.recipient_id=eq.${staffId}&notifications.entity_id=in.(${taskIds.join(",")})`,
      );
      expect(mails).toEqual([
        { state: "failed", last_error: "not_configured", notifications: expect.anything() },
        { state: "failed", last_error: "not_configured", notifications: expect.anything() },
      ]);

      // The window is over (it ended an hour ago): the next run sends ONE summary push.
      await serviceUpdate(`org_settings?org_id=eq.${settings!.org_id}`, {
        quiet_hours_start: istIn(-180),
        quiet_hours_end: istIn(-60),
      });
      await dispatch();
      expect(await pushStates()).toEqual(["sent", "sent"]);
      const mine = service.received.filter((push) => push.path === "/ok/quiet");
      expect(mine).toHaveLength(1);
      const opened = JSON.parse(
        Buffer.from(await decryptPayload(new Uint8Array(mine[0]!.body), receiver)).toString(),
      ) as { title: string; url: string; tag: string };
      expect(opened).toMatchObject({
        title: "2 updates while you were away",
        url: "/notifications",
        tag: `summary:${staffId}`,
      });
    } finally {
      await serviceUpdate(`org_settings?org_id=eq.${settings!.org_id}`, {
        quiet_hours_start: settings!.quiet_hours_start,
        quiet_hours_end: settings!.quiet_hours_end,
      });
      await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
      await new Promise<void>((resolve) => service.server.close(() => resolve()));
    }
  });
});
