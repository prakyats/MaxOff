import { decryptPayload, generateReceiverKeys } from "../src/core/notifications/push/encrypt";
import { systemClock } from "../src/core/time";
import { expect, test } from "./fixtures";
import {
  insertAs,
  memberIdOf,
  rpcAs,
  serviceDelete,
  serviceSelect,
  serviceUpdate,
  storageStateFor,
  USERS,
} from "./helpers";
import {
  addDevice,
  assignTask,
  fakePushService,
  noQuietHours,
  ownTheDispatchQueue,
  PUSH_PASSWORD,
  pushDeliveryOf,
  type Receiver,
  runDispatch,
} from "./push-shared";

/**
 * The push and email dispatch through the real cron route (task 5.2, WORKFLOWS §9a), made
 * deterministic (owner decision 29): this file runs in the serial `push-cron` project, one
 * worker, after every other project (playwright.config.ts; CI runs it alone after owner-bulk).
 * `beforeAll` owns the queue (every delivery still waiting is closed, `ownTheDispatchQueue`) and
 * turns quiet hours off once, so each step dispatches **once** and asserts its own row. No loop
 * runs the cron until something happens.
 *
 * The device is a fake push service on the loopback host (`push-shared.ts`); the person is the
 * desktop project's push fixture, whose own spec has finished by now.
 */
const PERSON = "push-desktop@maxoff.local";

test.describe("push and email dispatch (cron)", () => {
  test.describe.configure({ mode: "serial" });

  let service: Awaited<ReturnType<typeof fakePushService>>;
  let receiver: Receiver;
  let restoreQuietHours: () => Promise<void>;
  let staffId: string;

  test.beforeAll(async () => {
    service = await fakePushService();
    receiver = await generateReceiverKeys();
    staffId = await memberIdOf(PERSON);
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
    restoreQuietHours = await noQuietHours();
    await ownTheDispatchQueue();
  });

  test.afterEach(async () => {
    await serviceDelete(`push_subscriptions?member_id=eq.${staffId}`);
  });

  test.afterAll(async () => {
    await restoreQuietHours();
    await new Promise<void>((resolve) => service.server.close(() => resolve()));
  });

  /** Every push this test's receiver got whose title is `title`, opened. */
  async function pushesTitled(title: string, since: number) {
    const found = [];
    for (const push of service.received.slice(since)) {
      const opened = JSON.parse(
        Buffer.from(await decryptPayload(new Uint8Array(push.body), receiver)).toString(),
      ) as { title: string; body: string | null; url: string; notificationId: string | null };
      if (opened.title === title) found.push(opened);
    }
    return found;
  }

  test("a real transition's push reaches the device through one cron run, and never twice", async ({
    request,
  }) => {
    await addDevice(staffId, `${service.url}/ok/cron`, receiver);
    const before = service.received.length;
    const title = `Push proof ${systemClock().getTime()}`;
    const taskId = await assignTask(staffId, title);
    // The cron route: refused without the secret, then the one run that sends what is due.
    expect((await request.post("/api/cron/push-dispatch")).status()).toBe(401);
    const report = (await runDispatch(request)) as { job?: string };
    expect(report.job).toBe("push_dispatch");
    expect(await pushDeliveryOf(staffId, taskId)).toMatchObject({ state: "sent" });
    const mine = await pushesTitled(`New task: ${title}`, before);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ url: `/tasks/${taskId}` });
    expect(mine[0]!.notificationId).toBeTruthy();
    // A second run sends nothing again (idempotent).
    await runDispatch(request);
    expect(await pushesTitled(`New task: ${title}`, before)).toHaveLength(1);
  });

  test("a device answering 410 is disabled; one failing is retried with backoff", async ({
    request,
  }) => {
    // 410: the device is gone, and with no other device the row fails `no_subscription`.
    const goneId = await addDevice(staffId, `${service.url}/gone/dispatch`, receiver);
    const goneTask = await assignTask(staffId, `Push gone ${systemClock().getTime()}`);
    await runDispatch(request);
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
    await runDispatch(request);
    const first = await pushDeliveryOf(staffId, downTask);
    expect(first).toMatchObject({ state: "queued", attempts: 1, last_error: "HTTP 500" });
    const wait = Date.parse(first.next_attempt_at) - sentAt;
    expect(wait).toBeGreaterThan(30_000);
    expect(wait).toBeLessThan(120_000);

    const tries = () => service.received.filter((push) => push.path === "/down/dispatch").length;
    const triedOnce = tries();
    await runDispatch(request);
    expect(tries(), "not retried before it is due").toBe(triedOnce);

    // Due now (the minute is moved back, not waited out): retried, then 5 minutes.
    await serviceUpdate(`notification_deliveries?id=eq.${first.id}`, {
      next_attempt_at: new Date(sentAt - 1000).toISOString(),
    });
    const retriedAt = systemClock().getTime();
    await runDispatch(request);
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
    // This row's retries are its own: closed so the next test's run starts from an empty queue.
    await serviceUpdate(`notification_deliveries?id=eq.${first.id}`, {
      state: "failed",
      last_error: "e2e_cleared",
    });
  });

  test("a transition's push goes out right after the action, without waiting for the cron", async ({
    browser,
    request,
  }) => {
    await addDevice(staffId, `${service.url}/ok/after`, receiver);
    const title = `Push after ${systemClock().getTime()}`;
    const taskId = await assignTask(staffId, title);
    // The assignment came through the API (no action, so no after()): one cron run sends it.
    await runDispatch(request);
    expect(await pushDeliveryOf(staffId, taskId)).toMatchObject({ state: "sent" });

    // The Owner comments through the app: the action's after() sends the comment's push. No
    // cron runs in this e2e server, so a push arriving now can only be that dispatch.
    const owner = await browser.newContext({ storageState: storageStateFor("owner") });
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

    const commentPushes = () => pushesTitled(`Comment on ${title}`, 0);
    // after() runs once the response is sent: waited for, never re-triggered.
    await expect.poll(async () => (await commentPushes()).length).toBe(1);
    expect((await commentPushes())[0]).toMatchObject({
      body: expect.stringContaining("Straight to the phone"),
      url: `/tasks/${taskId}`,
    });
  });

  test("email: a person with no push gets one email per actionable row; a comment none", async ({
    request,
  }) => {
    const taskId = await assignTask(staffId, `Email proof ${systemClock().getTime()}`);
    await rpcAs(PERSON, PUSH_PASSWORD, "task_submit_done", { task_id: taskId });
    await rpcAs(USERS.owner.email, USERS.owner.password, "task_review", {
      task_id: taskId,
      decision: "rejected",
      reason: "Brighter colours",
    });
    await insertAs(USERS.owner.email, USERS.owner.password, "task_comments", {
      task_id: taskId,
      body: "The music is in the folder.",
    });
    await runDispatch(request);
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
    await runDispatch(request);
    expect(await mails()).toHaveLength(2);
  });
});
