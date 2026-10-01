import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { type Page, type TestInfo } from "@playwright/test";

import { fromBase64Url } from "../src/core/notifications/push/base64url";
import { DISPATCH_LIMIT } from "../src/core/notifications/push/dispatcher";
import { systemClock } from "../src/core/time";
import { decryptPayload, generateReceiverKeys } from "../src/core/notifications/push/encrypt";
import { verifyVapidToken } from "../src/core/notifications/push/vapid";
import { expect, test } from "./fixtures";
import {
  expectBackStack,
  hydrated,
  insertAs,
  memberIdOf,
  rpcAs,
  runInstalled,
  serviceDelete,
  serviceInsert,
  serviceSelect,
  serviceUpdate,
  signIn,
  storageStateFor,
  taskTypeId,
  USERS,
} from "./helpers";

/**
 * Web Push (task 5.2, WORKFLOWS §9a, kickoff 5 decisions 1, 5 and 9). Headless Chromium has no
 * push service, so `PushManager.subscribe` and `Notification` are stubbed **in the browser**
 * (the platform's answer is faked); everything behind them is real: the subscription RPC, the
 * banner's per-member rule, Me's rows, the test push, the cron dispatch, VAPID and the RFC 8291
 * encryption. The pushes go to a fake push service this file runs on the loopback host, which
 * keeps every POST; the spec decrypts them with the throwaway receiver keys it made and
 * verifies the VAPID token with the run's throwaway public key (playwright.config.ts).
 *
 * Each project has its own Staff member (seeded `push-<project>@maxoff.local`): the banner is
 * judged per member, so the projects running side by side never share one person's
 * subscriptions. Their subscriptions are removed at the start and the end.
 */
const CRON_SECRET = process.env.CRON_SECRET ?? "e2e-only-cron-secret-not-used-anywhere-else";

type Received = { path: string; authorization: string; encoding: string; body: Buffer };

/** The fake push service: 201 for `/ok/*`, 410 for `/gone/*`, 500 for `/down/*`. */
function fakePushService(): Promise<{ server: Server; url: string; received: Received[] }> {
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

type Receiver = { privateKey: string; publicKey: string; auth: string };

/**
 * Fakes the platform before the page's scripts: `Notification.permission` and
 * `requestPermission` answer as told, `PushManager.subscribe` / `getSubscription` hand back a
 * subscription at the fake service with the receiver's real keys (so the server's encryption
 * can be opened here). The service worker itself is real (a production build).
 */
async function stubPush(
  page: Page,
  options: { permission: "default" | "granted" | "denied"; endpoint: string; receiver: Receiver },
) {
  await page.addInitScript(({ permission, endpoint, receiver }) => {
    const decode = (text: string) => {
      const normalised = text.replace(/-/g, "+").replace(/_/g, "/");
      const binary = atob(normalised + "=".repeat((4 - (normalised.length % 4)) % 4));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    };
    let current: PushSubscription | null = null;
    const fake = {
      endpoint,
      expirationTime: null,
      options: { userVisibleOnly: true, applicationServerKey: null },
      getKey: (name: string) =>
        name === "p256dh" ? decode(receiver.publicKey) : decode(receiver.auth),
      toJSON: () => ({ endpoint }),
      unsubscribe: async () => {
        current = null;
        return true;
      },
    } as unknown as PushSubscription;
    let state: NotificationPermission = permission;
    Object.defineProperty(Notification, "permission", { get: () => state, configurable: true });
    Notification.requestPermission = async () => {
      state = state === "default" ? "granted" : state;
      (window as unknown as { __permissionAsked: boolean }).__permissionAsked = true;
      return state;
    };
    PushManager.prototype.subscribe = async function subscribe() {
      current = fake;
      return fake;
    };
    PushManager.prototype.getSubscription = async function getSubscription() {
      return current;
    };
  }, options);
}

const PUSH_PASSWORD = "push-local-password";

/** This project's own Staff member. */
function pushPerson(info: TestInfo): string {
  return `push-${info.project.name}@maxoff.local`;
}

async function removeSubscriptionsOf(email: string): Promise<void> {
  const memberId = await memberIdOf(email);
  await serviceDelete(`push_subscriptions?member_id=eq.${memberId}`);
}

async function noQuietHours(): Promise<() => Promise<void>> {
  const [row] = await serviceSelect<{
    org_id: string;
    quiet_hours_start: string;
    quiet_hours_end: string;
  }>("org_settings?select=org_id,quiet_hours_start,quiet_hours_end");
  expect(row, "one org_settings row").toBeTruthy();
  const { org_id, quiet_hours_start, quiet_hours_end } = row!;
  // Equal times mean no window (push_quiet), so the dispatch proof holds at any hour.
  await serviceUpdate(`org_settings?org_id=eq.${org_id}`, {
    quiet_hours_start: "07:00",
    quiet_hours_end: "07:00",
  });
  return () =>
    serviceUpdate(`org_settings?org_id=eq.${org_id}`, { quiet_hours_start, quiet_hours_end });
}

/** Runs the cron dispatch until a run claims less than a full batch: the backlog is worked off. */
async function drainDispatch(page: Page): Promise<void> {
  for (let run = 0; run < 50; run += 1) {
    const response = await page.request.post("/api/cron/push-dispatch", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(response.ok()).toBe(true);
    const report = (await response.json()) as { claimed: number };
    if (report.claimed < DISPATCH_LIMIT) return;
  }
  throw new Error("the dispatch backlog did not drain");
}

async function runDispatch(page: Page): Promise<void> {
  const response = await page.request.post("/api/cron/push-dispatch", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  expect(response.ok()).toBe(true);
}

/** A task the Owner assigns to this person (task_assigned), through the API. */
async function assignTask(staffId: string, title: string): Promise<string> {
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

type PushDelivery = {
  id: string;
  state: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
};

/** The push delivery of this person's row about a task. */
async function pushDeliveryOf(staffId: string, taskId: string): Promise<PushDelivery> {
  const rows = await serviceSelect<PushDelivery>(
    `notification_deliveries?channel=eq.push&select=id,state,attempts,last_error,next_attempt_at,notifications!inner(recipient_id,entity_id)&notifications.recipient_id=eq.${staffId}&notifications.entity_id=eq.${taskId}`,
  );
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

/** A device of this person at the fake push service, stored as the API would. */
async function addDevice(staffId: string, endpoint: string, receiver: Receiver): Promise<string> {
  const row = await serviceInsert<{ id: string }>("push_subscriptions", {
    member_id: staffId,
    endpoint,
    p256dh: receiver.publicKey,
    auth: receiver.auth,
    platform: "android",
  });
  return row.id;
}

test.describe("Web Push", () => {
  test.describe.configure({ mode: "serial" });
  // Signed in as this project's own person in beforeEach, not from a saved session.
  test.use({ storageState: { cookies: [], origins: [] } });

  let service: Awaited<ReturnType<typeof fakePushService>>;
  let receiver: Receiver;
  let restoreQuietHours: () => Promise<void>;

  test.beforeAll(async ({}, info) => {
    service = await fakePushService();
    receiver = await generateReceiverKeys();
    restoreQuietHours = await noQuietHours();
    await removeSubscriptionsOf(pushPerson(info));
  });

  test.beforeEach(async ({ page }, info) => {
    await signIn(page, pushPerson(info), PUSH_PASSWORD);
  });

  test.afterAll(async ({}, info) => {
    await removeSubscriptionsOf(pushPerson(info));
    await restoreQuietHours();
    await new Promise<void>((resolve) => service.server.close(() => resolve()));
  });

  test("the banner asks on every screen, permission only on the tap; one device stops it everywhere", async ({
    page,
    isMobile,
  }) => {
    await stubPush(page, {
      permission: "default",
      endpoint: `${service.url}/ok/staff-phone`,
      receiver,
    });
    await page.goto("/my-day");
    const banner = page.locator('[data-slot="push-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-state", "default");
    // One line above the bottom bar (5A decision 30): "Notifications are off · Turn on".
    await expect(banner.getByText("Notifications are off").filter({ visible: true })).toBeVisible();
    // Nothing was asked yet: permission is requested only on the tap (decision 9).
    expect(
      await page.evaluate(
        () => (window as unknown as { __permissionAsked?: boolean }).__permissionAsked,
      ),
    ).toBeUndefined();
    // On another screen too, and no dismiss anywhere.
    await page.goto("/tasks");
    await expect(page.locator('[data-slot="push-banner"]')).toBeVisible();
    await expect(
      page.locator('[data-slot="push-banner"]').getByRole("button", { name: /dismiss|close/i }),
    ).toHaveCount(0);

    // The band opens a sheet; opening it asks nothing yet, its button does.
    await page.locator('[data-slot="push-banner"]').click();
    const sheet = page.locator('[data-slot="push-sheet"]');
    await expect(sheet.getByRole("heading", { name: "Turn on notifications" })).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as unknown as { __permissionAsked?: boolean }).__permissionAsked,
      ),
    ).toBeUndefined();
    await sheet.locator('[data-slot="push-enable"]').click();
    expect(
      await page.evaluate(
        () => (window as unknown as { __permissionAsked?: boolean }).__permissionAsked,
      ),
    ).toBe(true);
    await expect(page.locator('[data-slot="push-banner"]')).toBeHidden();
    await expect(sheet).toHaveCount(0);
    const staffId = await memberIdOf(pushPerson(test.info()));
    const rows = await serviceSelect<{
      endpoint: string;
      platform: string;
      disabled_at: string | null;
    }>(`push_subscriptions?member_id=eq.${staffId}&select=endpoint,platform,disabled_at`);
    expect(rows).toEqual([
      // The phone projects emulate an Android phone, so the platform follows the device.
      {
        endpoint: `${service.url}/ok/staff-phone`,
        platform: isMobile ? "android" : "desktop",
        disabled_at: null,
      },
    ]);

    // Judged per member: a second browser of theirs with no subscription sees no banner, and Me
    // shows the quiet row instead (decision 9).
    const other = await page
      .context()
      .browser()!
      .newContext({
        storageState: await page.context().storageState(),
        viewport: page.viewportSize(),
      });
    const second = await other.newPage();
    await stubPush(second, {
      permission: "default",
      endpoint: `${service.url}/ok/staff-laptop`,
      receiver,
    });
    await second.goto("/me");
    await expect(second.locator('[data-slot="push-banner"]')).toHaveCount(0);
    const row = second.locator('[data-slot="push-device-row"]');
    await expect(row).toHaveAttribute("data-state", "elsewhere");
    await expect(
      row.getByText("Notifications are on for your phone. Turn them on here too."),
    ).toBeVisible();
    await other.close();
  });

  test("Me: this device is on; Send a test reaches the device, encrypted and signed", async ({
    page,
  }) => {
    await stubPush(page, {
      permission: "granted",
      endpoint: `${service.url}/ok/staff-phone`,
      receiver,
    });
    await page.goto("/me");
    const row = page.locator('[data-slot="push-device-row"]');
    await expect(row).toHaveAttribute("data-state", "here");
    await expect(row.getByText("Notifications are on for this device.")).toBeVisible();

    const before = service.received.length;
    await page.locator('[data-slot="push-test"]').click();
    await expect(page.locator('[data-slot="push-test-outcome"]')).toHaveText("Sent to 1 device");
    const pushes = service.received.slice(before);
    expect(pushes).toHaveLength(1);
    const [push] = pushes;
    expect(push!.path).toBe("/ok/staff-phone");
    expect(push!.encoding).toBe("aes128gcm");
    // The VAPID token verifies with this run's public key and names the fake service's origin.
    const token = push!.authorization.slice("vapid t=".length, push!.authorization.indexOf(", k="));
    expect(await verifyVapidToken(process.env.E2E_VAPID_PUBLIC_KEY ?? "", token)).toBe(true);
    const claims = JSON.parse(Buffer.from(fromBase64Url(token.split(".")[1]!)).toString()) as {
      aud: string;
      sub: string;
    };
    expect(claims).toMatchObject({ aud: service.url, sub: "mailto:e2e@maxoff.local" });
    // Only the receiver's keys open it: the full text, no notifications row behind it.
    const opened = JSON.parse(
      Buffer.from(await decryptPayload(new Uint8Array(push!.body), receiver)).toString(),
    ) as {
      title: string;
      url: string;
      tag: string;
    };
    expect(opened).toMatchObject({ title: "MaxOff notifications are on", url: "/me", tag: "test" });
    const staffId = await memberIdOf(pushPerson(test.info()));
    const [sub] = await serviceSelect<{ last_test_at: string | null }>(
      `push_subscriptions?member_id=eq.${staffId}&select=last_test_at`,
    );
    expect(sub?.last_test_at, "last_test_at is stamped").toBeTruthy();
  });

  test("a real transition's push reaches the device through the cron dispatch", async ({
    page,
  }) => {
    const staffId = await memberIdOf(pushPerson(test.info()));
    // The dispatcher sends the oldest due rows first, up to its batch: rows the earlier specs
    // queued for people with no device are worked off first.
    await drainDispatch(page);
    const before = service.received.length;
    const now = systemClock();
    const title = `Push proof ${now.getTime()}`;
    const taskId = await rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
      title,
      description: null,
      task_type_id: await taskTypeId("Normal"),
      client_id: null,
      priority: "medium",
      due_at: new Date(now.getTime() + 3 * 24 * 3600 * 1000).toISOString(),
      assignee_ids: [staffId],
      primary_owner_id: staffId,
      approving_admin_id: null,
      stages: [],
    });
    // The cron route: refused without the secret, then the run that sends what is due.
    expect((await page.request.post("/api/cron/push-dispatch")).status()).toBe(401);
    const run = await page.request.post("/api/cron/push-dispatch", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(run.ok()).toBe(true);
    const report = (await run.json()) as { job: string; sent: number };
    expect(report.job).toBe("push_dispatch");
    // A run sends the oldest due rows first, up to its batch; while other specs keep queueing
    // rows for people with no device, the next minute's runs catch up (the cron's contract).
    for (let run = 0; run < 20; run += 1) {
      if ((await pushDeliveryOf(staffId, taskId)).state !== "queued") break;
      await runDispatch(page);
    }
    const pushes = service.received.slice(before);
    const mine = [];
    for (const push of pushes) {
      const opened = JSON.parse(
        Buffer.from(await decryptPayload(new Uint8Array(push.body), receiver)).toString(),
      ) as {
        title: string;
        url: string;
        notificationId: string | null;
      };
      if (opened.title === `New task: ${title}`) mine.push(opened);
    }
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ url: `/tasks/${taskId}` });
    expect(mine[0]!.notificationId).toBeTruthy();
    const deliveries = await serviceSelect<{ state: string; sent_at: string | null }>(
      `notification_deliveries?channel=eq.push&select=state,sent_at,notifications!inner(recipient_id,entity_id)&notifications.recipient_id=eq.${staffId}&notifications.entity_id=eq.${taskId}`,
    );
    expect(deliveries.map((row) => row.state)).toEqual(["sent"]);
    // A second run sends nothing again (idempotent).
    const again = await page.request.post("/api/cron/push-dispatch", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(again.ok()).toBe(true);
    // Other projects' rows may be due at the same moment (the dispatcher is organization-wide),
    // so the proof is this row's: it is never sent twice.
    const resent = [];
    for (const push of service.received.slice(before)) {
      const opened = JSON.parse(
        Buffer.from(await decryptPayload(new Uint8Array(push.body), receiver)).toString(),
      ) as { title: string };
      if (opened.title === `New task: ${title}`) resent.push(opened);
    }
    expect(resent).toHaveLength(1);
  });

  test("a device that answers gone is disabled and the test says so", async ({ page }) => {
    const staffId = await memberIdOf(pushPerson(test.info()));
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
    await stubPush(page, {
      permission: "granted",
      endpoint: `${service.url}/down/staff-phone`,
      receiver,
    });
    await page.goto("/me");
    // Permission granted, no row on the server: PushSync stores this device on load.
    await expect(page.locator('[data-slot="push-device-row"]')).toHaveAttribute(
      "data-state",
      "here",
    );
    await page.locator('[data-slot="push-test"]').click();
    await expect(page.locator('[data-slot="push-test-outcome"]')).toHaveText(
      "No device accepted it. Check the device's notification settings, then try again.",
    );
  });

  test("the cron dispatch: a device answering 410 is disabled; one failing is retried with backoff", async ({
    page,
  }) => {
    const staffId = await memberIdOf(pushPerson(test.info()));
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
    await drainDispatch(page);

    // 410: the device is gone, and with no other device the row fails `no_subscription`.
    const goneId = await addDevice(staffId, `${service.url}/gone/dispatch`, receiver);
    const goneTask = await assignTask(staffId, `Push gone ${systemClock().getTime()}`);
    await runDispatch(page);
    expect(service.received.some((push) => push.path === "/gone/dispatch")).toBe(true);
    const [gone] = await serviceSelect<{ disabled_reason: string | null }>(
      `push_subscriptions?id=eq.${goneId}&select=disabled_reason`,
    );
    expect(gone?.disabled_reason).toBe("gone");
    expect(await pushDeliveryOf(staffId, goneTask)).toMatchObject({
      state: "failed",
      last_error: "no_subscription",
    });

    // 500: retried after 1 minute, then 5; nothing is sent before it is due.
    const downId = await addDevice(staffId, `${service.url}/down/dispatch`, receiver);
    const downTask = await assignTask(staffId, `Push down ${systemClock().getTime()}`);
    const sentAt = systemClock().getTime();
    await runDispatch(page);
    const first = await pushDeliveryOf(staffId, downTask);
    expect(first).toMatchObject({ state: "queued", attempts: 1 });
    expect(first.last_error).toBeTruthy();
    const wait = Date.parse(first.next_attempt_at) - sentAt;
    expect(wait).toBeGreaterThan(30_000);
    expect(wait).toBeLessThan(120_000);

    const tries = () => service.received.filter((push) => push.path === "/down/dispatch").length;
    const triedOnce = tries();
    await runDispatch(page);
    expect(tries(), "not retried before it is due").toBe(triedOnce);

    // Due now (the minute is moved back, not waited out): retried, then 5 minutes.
    await serviceUpdate(`notification_deliveries?id=eq.${first.id}`, {
      next_attempt_at: new Date(sentAt - 1000).toISOString(),
    });
    const retriedAt = systemClock().getTime();
    await runDispatch(page);
    expect(tries()).toBe(triedOnce + 1);
    const second = await pushDeliveryOf(staffId, downTask);
    expect(second).toMatchObject({ state: "queued", attempts: 2 });
    const wait2 = Date.parse(second.next_attempt_at) - retriedAt;
    expect(wait2).toBeGreaterThan(4 * 60_000);
    expect(wait2).toBeLessThan(6 * 60_000);
    const [down] = await serviceSelect<{ failure_count: number; disabled_at: string | null }>(
      `push_subscriptions?id=eq.${downId}&select=failure_count,disabled_at`,
    );
    expect(down).toEqual({ failure_count: 2, disabled_at: null });
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
  });

  test("a transition's push goes out right after the action, without waiting for the cron", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "the desktop composer; the dispatch itself is the server's");
    const staffId = await memberIdOf(pushPerson(test.info()));
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
    await addDevice(staffId, `${service.url}/ok/after`, receiver);
    const title = `Push after ${systemClock().getTime()}`;
    const taskId = await assignTask(staffId, title);
    // The assignment came through the API (no action, so no after()): the cron sends it.
    await drainDispatch(page);

    // The Owner comments through the app: the action's after() sends the comment's push. No
    // cron runs in this e2e server, so a push arriving now can only be that dispatch.
    const owner = await page
      .context()
      .browser()!
      .newContext({ storageState: storageStateFor("owner"), viewport: page.viewportSize() });
    const ownerPage = await owner.newPage();
    await ownerPage.goto(`/tasks/${taskId}`);
    await ownerPage.locator('[data-slot="task-tab"][data-view-tab="chat"]').click();
    const composer = ownerPage.locator('[data-slot="task-panel-chat"]');
    await composer.getByRole("textbox", { name: "Comment" }).fill("Straight to the phone");
    await composer.getByRole("button", { name: "Send" }).click();
    await expect(composer.locator('[data-slot="task-comment"][data-own="true"]')).toContainText(
      "Straight to the phone",
    );
    await owner.close();

    const commentPushes = async () => {
      const found = [];
      for (const push of service.received.filter((each) => each.path === "/ok/after")) {
        const opened = JSON.parse(
          Buffer.from(await decryptPayload(new Uint8Array(push.body), receiver)).toString(),
        ) as { title: string; body: string | null; url: string };
        if (opened.title === `Comment on ${title}`) found.push(opened);
      }
      return found;
    };
    await expect.poll(async () => (await commentPushes()).length).toBe(1);
    expect((await commentPushes())[0]).toMatchObject({
      body: expect.stringContaining("Straight to the phone"),
      url: `/tasks/${taskId}`,
    });
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
  });

  test("Sign out of this device deletes this device's subscription", async ({ page }) => {
    const staffId = await memberIdOf(pushPerson(test.info()));
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
    // Another device of theirs stays: only this one goes.
    await addDevice(staffId, `${service.url}/ok/other-device`, receiver);
    await stubPush(page, {
      permission: "granted",
      endpoint: `${service.url}/ok/signing-out`,
      receiver,
    });
    await page.goto("/me");
    // Permission granted and no row for this browser: PushSync stores it on load.
    await expect(page.locator('[data-slot="push-device-row"]')).toHaveAttribute(
      "data-state",
      "here",
    );
    await expect
      .poll(async () =>
        (
          await serviceSelect<{ endpoint: string }>(
            `push_subscriptions?member_id=eq.${staffId}&select=endpoint&order=endpoint`,
          )
        ).map((row) => row.endpoint),
      )
      .toEqual([`${service.url}/ok/other-device`, `${service.url}/ok/signing-out`]);

    await page.getByRole("button", { name: "Sign out" }).click();
    await page
      .getByRole("alertdialog", { name: "Sign out of this device?" })
      .getByRole("button", { name: "Sign out" })
      .click();
    await expect(page).toHaveURL(/\/login/);
    const left = await serviceSelect<{ endpoint: string }>(
      `push_subscriptions?member_id=eq.${staffId}&select=endpoint`,
    );
    expect(left.map((row) => row.endpoint)).toEqual([`${service.url}/ok/other-device`]);
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
  });

  test("installed: the band's sheet closes on back; its Turn on adds no history; back from home leaves", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "installed-mode back is a phone rule (375 and 430)");
    const staffId = await memberIdOf(pushPerson(test.info()));
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
    await runInstalled(page);
    await stubPush(page, {
      permission: "default",
      endpoint: `${service.url}/ok/installed-banner`,
      receiver,
    });
    await page.goto("/my-day");
    await hydrated(page);
    const band = page.locator('[data-slot="push-banner"]');
    const sheet = page.locator('[data-slot="push-sheet"]');
    // The sheet is a layer (§14.2 a): back closes it and the screen stays.
    await band.click();
    await expect(sheet).toBeVisible();
    await page.goBack();
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(/\/my-day$/);
    await expect(band).toBeVisible();
    // Turned on from the sheet: the sheet's entry goes, the band goes, nothing is added.
    await band.click();
    await sheet.locator('[data-slot="push-enable"]').click();
    await expect(band).toBeHidden();
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(/\/my-day$/);
    // The band is no drill-down: one back leaves the app.
    await expectBackStack(page, [{ url: /^about:blank$/ }]);
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
  });

  test('installed: Me\'s "Turn them on here too" and Send test add no history; back returns home', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "installed-mode back is a phone rule (375 and 430)");
    const staffId = await memberIdOf(pushPerson(test.info()));
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
    // On for another device of theirs: this one shows the quiet row (decision 9).
    await addDevice(staffId, `${service.url}/ok/installed-other`, receiver);
    await runInstalled(page);
    await stubPush(page, {
      permission: "default",
      endpoint: `${service.url}/ok/installed-me`,
      receiver,
    });
    await page.goto("/my-day");
    await hydrated(page);
    await page.locator("[data-slot='bottom-nav']").getByRole("link", { name: "Me" }).click();
    await expect(page).toHaveURL(/\/me$/);
    const row = page.locator('[data-slot="push-device-row"]');
    await expect(row).toHaveAttribute("data-state", "elsewhere");
    await row.locator('[data-slot="push-enable"]').click();
    await expect(row).toHaveAttribute("data-state", "here");
    await page.locator('[data-slot="push-test"]').click();
    await expect(page.locator('[data-slot="push-test-outcome"]')).toHaveText("Sent to 2 devices");
    await expect(page).toHaveURL(/\/me$/);
    // Me is a tab above home: back returns to My Day, the next back leaves.
    await expectBackStack(page, [{ url: /\/my-day$/ }, { url: /^about:blank$/ }]);
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
  });

  test("email: a person with no push gets one email per actionable row; a comment none", async ({
    page,
  }) => {
    const email = pushPerson(test.info());
    const staffId = await memberIdOf(email);
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
    const taskId = await assignTask(staffId, `Email proof ${systemClock().getTime()}`);
    await rpcAs(email, PUSH_PASSWORD, "task_submit_done", { task_id: taskId });
    await rpcAs(USERS.owner.email, USERS.owner.password, "task_review", {
      task_id: taskId,
      decision: "rejected",
      reason: "Brighter colours",
    });
    await insertAs(USERS.owner.email, USERS.owner.password, "task_comments", {
      task_id: taskId,
      body: "The music is in the folder.",
    });
    await drainDispatch(page);
    const mails = async () =>
      (
        await serviceSelect<{
          state: string;
          last_error: string | null;
          notifications: { kind: string };
        }>(
          `notification_deliveries?channel=eq.email&select=state,last_error,notifications!inner(kind,recipient_id,entity_id)&notifications.recipient_id=eq.${staffId}&notifications.entity_id=eq.${taskId}`,
        )
      )
        .map((row) => `${row.notifications.kind}:${row.state}:${row.last_error ?? "-"}`)
        .sort();
    // Task assigned is always emailed; changes requested is actionable and they have no push;
    // the comment never. The e2e server has no RESEND_API_KEY (as team.spec's invites rely on),
    // so each is recorded not_configured: nothing is sent, nothing crashed.
    expect(await mails()).toEqual([
      "task_assigned:failed:not_configured",
      "task_changes_requested:failed:not_configured",
    ]);
    // Another run adds nothing: one email row per notification.
    await runDispatch(page);
    expect(await mails()).toHaveLength(2);
  });

  test("denied: the band's sheet says how to re-enable and never asks again", async ({ page }) => {
    const staffId = await memberIdOf(pushPerson(test.info()));
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
    await stubPush(page, { permission: "denied", endpoint: `${service.url}/ok/x`, receiver });
    await page.goto("/my-day");
    const banner = page.locator('[data-slot="push-banner"]');
    await expect(banner).toHaveAttribute("data-state", "denied");
    await expect(banner.getByText("Notifications are off").filter({ visible: true })).toBeVisible();
    await banner.click();
    const sheet = page.locator('[data-slot="push-sheet"]');
    await expect(
      sheet.getByRole("heading", { name: "Notifications are blocked on this device" }),
    ).toBeVisible();
    await expect(sheet.getByText(/site settings/)).toBeVisible();
    await expect(page.locator('[data-slot="push-enable"]')).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await page.goto("/me");
    await expect(page.locator('[data-slot="push-device-row"]')).toHaveAttribute(
      "data-state",
      "blocked",
    );
    await expect(page.locator('[data-slot="push-test"]')).toBeDisabled();
  });

  test("the band fits a phone: 44px targets, no sideways scroll, nothing at the top moves, nothing hides behind it", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "the phone layout");
    const staffId = await memberIdOf(pushPerson(test.info()));
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
    await stubPush(page, { permission: "default", endpoint: `${service.url}/ok/x`, receiver });
    await page.goto("/my-day");
    await hydrated(page);
    const band = page.locator('[data-slot="push-banner"]');
    const bandBox = await band.boundingBox();
    expect(bandBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(bandBox?.width ?? 0).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    // Never at the top (decision 30): the title bar sits right under the brand bar…
    const title = await page.locator('[data-slot="page-header"]').first().boundingBox();
    const brand = await page.locator('[data-slot="top-bar"]').first().boundingBox();
    expect(
      Math.abs((title?.y ?? 0) - ((brand?.y ?? 0) + (brand?.height ?? 0))),
    ).toBeLessThanOrEqual(1);
    // …and its height is reserved: scrolled to the end, the last content ends above it.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const last = await page.locator("main > *").last().boundingBox();
    const bandNow = await band.boundingBox();
    expect((last?.y ?? 0) + (last?.height ?? 0)).toBeLessThanOrEqual((bandNow?.y ?? 0) + 1);
    // The sheet's button is a 44px target too.
    await band.click();
    const button = await page.locator('[data-slot="push-enable"]').boundingBox();
    expect(button?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});

test.describe("the deep-link entry (ARCHITECTURE §14.2 h)", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("lands on the record with its list underneath: back goes to the list", async ({ page }) => {
    const staffId = await memberIdOf(USERS.staff.email);
    await page.goto(`/open?to=${encodeURIComponent(`/people/${staffId}`)}`);
    await expect(page).toHaveURL(new RegExp(`/people/${staffId}$`));
    // One back link per breakpoint (the header's on a phone, the text link from md up).
    await expect(page.locator('[data-slot="page-back"]:visible')).toBeVisible();
    await expectBackStack(page, [{ url: /\/people$/ }]);
  });

  test("a top-level screen sits on home; an outside or bad target goes home", async ({ page }) => {
    await page.goto("/open?to=%2Fapprovals");
    await expect(page).toHaveURL(/\/approvals$/);
    await expectBackStack(page, [{ url: /\/today$/ }]);
    await page.goto("/open?to=https%3A%2F%2Fevil.example%2Fx");
    await expect(page).toHaveURL(/\/today$/);
    await page.goto("/open");
    await expect(page).toHaveURL(/\/today$/);
  });

  test("installed: the same order on a phone", async ({ page, isMobile }) => {
    test.skip(!isMobile, "installed-mode back is a phone rule");
    await runInstalled(page);
    const staffId = await memberIdOf(USERS.staff.email);
    await page.goto(`/open?to=${encodeURIComponent(`/people/${staffId}`)}`);
    await expect(page).toHaveURL(new RegExp(`/people/${staffId}$`));
    await hydrated(page);
    await expectBackStack(page, [{ url: /\/people$/ }]);
  });
});
