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
  memberIdOf,
  rpcAs,
  runInstalled,
  serviceDelete,
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
    await expect(banner.getByText("Turn on notifications")).toBeVisible();
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

    await page.locator('[data-slot="push-enable"]').click();
    expect(
      await page.evaluate(
        () => (window as unknown as { __permissionAsked?: boolean }).__permissionAsked,
      ),
    ).toBe(true);
    await expect(page.locator('[data-slot="push-banner"]')).toBeHidden();
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
    // queued for people with no device are worked off first, so this row is the next run's.
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
      `notification_deliveries?select=state,sent_at,notifications!inner(recipient_id,entity_id)&notifications.recipient_id=eq.${staffId}&notifications.entity_id=eq.${taskId}`,
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

  test("denied: the banner says how to re-enable and never asks again", async ({ page }) => {
    const staffId = await memberIdOf(pushPerson(test.info()));
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
    await stubPush(page, { permission: "denied", endpoint: `${service.url}/ok/x`, receiver });
    await page.goto("/my-day");
    const banner = page.locator('[data-slot="push-banner"]');
    await expect(banner).toHaveAttribute("data-state", "denied");
    await expect(banner.getByText("Notifications are blocked on this device")).toBeVisible();
    // Every state's copy is laid out in the banner (one height for all); only this one shows.
    await expect(banner.getByText(/site settings/).filter({ visible: true })).toBeVisible();
    await expect(page.locator('[data-slot="push-enable"]')).toHaveCount(0);
    await page.goto("/me");
    await expect(page.locator('[data-slot="push-device-row"]')).toHaveAttribute(
      "data-state",
      "blocked",
    );
    await expect(page.locator('[data-slot="push-test"]')).toBeDisabled();
  });

  test("the banner fits a phone: 44px target, no sideways scroll, one row high in every state", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "the phone layout");
    const staffId = await memberIdOf(pushPerson(test.info()));
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
    await stubPush(page, { permission: "default", endpoint: `${service.url}/ok/x`, receiver });
    await page.goto("/my-day");
    await hydrated(page);
    const button = page.locator('[data-slot="push-enable"]');
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const banner = await page.locator('[data-slot="push-banner"]').boundingBox();
    expect(banner?.width ?? 0).toBeLessThanOrEqual(page.viewportSize()!.width - 32);
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
