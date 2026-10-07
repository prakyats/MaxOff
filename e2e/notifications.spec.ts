import { type Page, type Request, type Route, type TestInfo } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { addISTDays, istInstant, systemClock, todayIST } from "../src/core/time";
import { HOLD_PROXY_URL } from "./hold-proxy-config";
import { expect, test } from "./fixtures";
import {
  expectBackStack,
  expectNoHorizontalScroll,
  hydrated,
  memberIdOf,
  removeTasksTitled,
  rpcAs,
  runInstalled,
  serviceDelete,
  serviceInsert,
  serviceSelect,
  serviceUpdate,
  signIn,
  supabaseAuth,
  taskTypeId,
  USERS,
} from "./helpers";

/**
 * The bell and Alerts (task 5.1, kickoff 5 decision 4; owner cut (b), the simplest form): the
 * unread count on the bell (every role's title bar on a phone, the Crew's since 5B decision 1;
 * the top bar on desktop), the history newest first, a tap that reads the row and opens its link with
 * the parent list underneath, "Mark all read", opening a record reads its rows, and **Realtime**
 * (5A build decision 23): a new row reaches an open screen without a reload, through the e2e
 * server's hold proxy, and reaches its recipient only (RLS on Realtime, owner 2026-10-01).
 *
 * Each project has its own Staff member and Admin (seeded `alerts-<role>-<project>@maxoff.local`):
 * counts and Mark all read are per person, so the projects running side by side never share one.
 * The rows are written with the service role (`app.notify()`'s output, without a push delivery),
 * and each test removes that person's rows first.
 */
const PASSWORD = "alerts-local-password";

type Role = "staff" | "admin";

function person(info: TestInfo, role: Role): string {
  return `alerts-${role}-${info.project.name}@maxoff.local`;
}

/** Removes every notification of that person (local stack, fixtures only). */
async function clearAlerts(email: string): Promise<void> {
  await serviceDelete(`notifications?recipient_id=eq.${await memberIdOf(email)}`);
}

type Row = {
  title: string;
  kind?: string;
  /** When it came (ISO); else `minutesAgo` before now. */
  at?: string;
  body?: string;
  link?: string | null;
  entity?: string;
  entityId?: string;
  read?: boolean;
  minutesAgo?: number;
};

/** One notification for that person, as `app.notify()` writes it (no push delivery). */
async function notify(email: string, row: Row): Promise<string> {
  const [member] = await serviceSelect<{ id: string; org_id: string }>(
    `members?email=eq.${encodeURIComponent(email)}&select=id,org_id`,
  );
  if (!member) throw new Error(`no member ${email}`);
  const createdAt =
    row.at ?? new Date(systemClock().getTime() - (row.minutesAgo ?? 0) * 60_000).toISOString();
  const inserted = await serviceInsert<{ id: string }>("notifications", {
    org_id: member.org_id,
    recipient_id: member.id,
    kind: row.kind ?? "leave_decided",
    title: row.title,
    body: row.body ?? null,
    link: row.link ?? null,
    entity: row.entity ?? null,
    entity_id: row.entityId ?? null,
    created_at: createdAt,
    read_at: row.read ? createdAt : null,
  });
  return inserted.id;
}

async function unreadOf(email: string): Promise<number> {
  const id = await memberIdOf(email);
  return (await serviceSelect(`notifications?recipient_id=eq.${id}&read_at=is.null&select=id`))
    .length;
}

/** The visible unread count on whichever bell this screen shows; 0 when there is none. */
async function bellCount(page: Page): Promise<number> {
  // One look at the page, never a wait: a count-then-read could see the badge, then wait for it
  // forever once it went (CI 2026-10-01: a bell hydrating late dropped to 0 between the two).
  const shown = await page
    .locator('[data-slot="header-bell"], [data-slot="top-bar-bell"]')
    .locator('[data-slot="nav-badge"]:visible')
    .evaluateAll((badges) => badges.map((badge) => badge.textContent?.trim() ?? ""));
  return Number(shown[0] ?? "0");
}

function rowOf(page: Page, title: string) {
  return page.locator('[data-slot="notification-row"]', { hasText: title });
}

test.describe("the bell and Alerts", () => {
  test.describe.configure({ mode: "serial" });
  // Signed in as this project's own people, not from a saved session.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("Staff: newest first, the unread marked and counted; a tap reads it and opens it over its list", async ({
    page,
  }, info) => {
    const staff = person(info, "staff");
    await clearAlerts(staff);
    await notify(staff, { title: "Oldest, read", read: true, minutesAgo: 30 });
    await notify(staff, {
      title: "Nothing to open",
      body: "You were taken off a task.",
      minutesAgo: 20,
    });
    await notify(staff, {
      title: "Expense claim approved",
      body: "Open your claims.",
      link: "/leave/expenses",
      minutesAgo: 10,
    });
    await signIn(page, staff, PASSWORD);
    await page.goto("/notifications");
    await hydrated(page);

    const rows = page.locator('[data-slot="notification-row"]');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("Expense claim approved");
    await expect(rows.nth(1)).toContainText("Nothing to open");
    await expect(rows.nth(2)).toContainText("Oldest, read");
    await expect(page.locator('[data-slot="notification-row"][data-unread]')).toHaveCount(2);
    await expect(page.locator('[data-slot="notification-bar"]')).toContainText("2 unread");
    await expect.poll(() => bellCount(page)).toBe(2);

    // A tap: read, and the record opens with its list underneath (§14.2 h).
    await rowOf(page, "Expense claim approved").getByRole("link").click();
    await expect(page).toHaveURL(/\/leave\/expenses$/);
    await expect.poll(() => unreadOf(staff)).toBe(1);
    // Extra work & expenses sits on Me, where its row is (5B decision 3).
    await expectBackStack(page, [{ url: /\/me$/ }, { url: /\/notifications$/ }]);
    await expect(rowOf(page, "Expense claim approved")).not.toHaveAttribute("data-unread");
    await expect(page.locator('[data-slot="notification-bar"]')).toContainText("1 unread");
    await expect.poll(() => bellCount(page)).toBe(1);

    // A row with nothing to open is read by the tap, in place.
    await rowOf(page, "Nothing to open").getByRole("button").click();
    await expect(rowOf(page, "Nothing to open")).not.toHaveAttribute("data-unread");
    await expect(page.locator('[data-slot="notification-bar"]')).toContainText("All read");
    await expect(page.locator('[data-slot="mark-all-read"]')).toHaveCount(0);
    await expect.poll(() => bellCount(page)).toBe(0);
    // The screen shows the read at once; the write lands in the background (owner 2026-10-01).
    await expect.poll(() => unreadOf(staff)).toBe(0);
  });

  test("Mark all read reads every row and clears the count", async ({ page }, info) => {
    const staff = person(info, "staff");
    await clearAlerts(staff);
    await notify(staff, { title: "Leave approved", link: "/leave", minutesAgo: 5 });
    await notify(staff, { title: "Leave rejected", link: "/leave", minutesAgo: 4 });
    await signIn(page, staff, PASSWORD);
    await page.goto("/notifications");
    await hydrated(page);
    await expect.poll(() => bellCount(page)).toBe(2);

    await page.locator('[data-slot="mark-all-read"]').click();
    await expect(page.locator('[data-slot="notification-bar"]')).toContainText("All read");
    await expect(page.locator('[data-slot="notification-row"][data-unread]')).toHaveCount(0);
    await expect.poll(() => bellCount(page)).toBe(0);
    await expect.poll(() => unreadOf(staff)).toBe(0);
    // The server's truth after a refresh: still all read.
    await page.reload();
    await hydrated(page);
    await expect(page.locator('[data-slot="notification-bar"]')).toContainText("All read");
    expect(await bellCount(page)).toBe(0);
  });

  test("opening a task reads its rows in the background: a view tapped at once never reloads the page", async ({
    page,
  }, info) => {
    // Owner decision 2026-10-01 (PROGRESS Ideas (a)): a read never refreshes or reloads the page.
    // The receipt's answer is held until the views were switched, the case that used to reload.
    const staff = person(info, "staff");
    const prefix = `Read no reload ${info.project.name} `;
    await removeTasksTitled(prefix);
    await clearAlerts(staff);
    const staffId = await memberIdOf(staff);
    const taskId = await rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
      title: `${prefix}reel`,
      description: null,
      task_type_id: await taskTypeId("Normal"),
      client_id: null,
      priority: "medium",
      due_at: istInstant(addISTDays(todayIST(), 45), "18:00"),
      assignee_ids: [staffId],
      primary_owner_id: staffId,
      approving_admin_id: null,
      stages: [],
    });
    // Two rows about the task (its assignment, written by `task_create`, and one more) and one
    // about something else, which stays unread.
    await notify(staff, {
      title: "Changes requested",
      link: `/tasks/${taskId}`,
      entity: "tasks",
      entityId: taskId,
    });
    await notify(staff, { title: "Leave approved", link: "/leave" });
    const about = (
      await serviceSelect(
        `notifications?recipient_id=eq.${staffId}&entity_id=eq.${taskId}&read_at=is.null&select=id`,
      )
    ).length;
    expect(about).toBeGreaterThanOrEqual(1);
    const total = await unreadOf(staff);

    await signIn(page, staff, PASSWORD);
    await page.goto("/tasks");
    await hydrated(page);
    await expect.poll(() => bellCount(page)).toBe(total);

    // Everything this page sends by itself waits until the views were switched: any server
    // action, and the background calls (ARCHITECTURE §4.4: the read receipt, the live bell's
    // count, the app's report), which are plain requests to /api/.
    const background = (request: Request) =>
      (request.method() === "POST" && Boolean(request.headers()["next-action"])) ||
      new URL(request.url()).pathname.startsWith("/api/");
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held: Request[] = [];
    const inFlight = new Set<Request>();
    page.on("request", (request) => {
      if (background(request)) inFlight.add(request);
    });
    page.on("requestfinished", (request) => inFlight.delete(request));
    page.on("requestfailed", (request) => inFlight.delete(request));
    // An answer that revalidates re-renders the page (Next reloads it when that lands after a
    // view switch): none of this page's answers may.
    const revalidated: string[] = [];
    page.on("response", (response) => {
      const kind = response.headers()["x-action-revalidated"];
      if (response.request().headers()["next-action"] && kind && kind !== "0") {
        revalidated.push(`${response.url()} ${kind}`);
      }
    });
    await page.route("**/*", async (route: Route) => {
      const request = route.request();
      if (background(request)) {
        held.push(request);
        await released;
      }
      await route.fallback();
    });
    // A reload would lose this marker and fire a load event.
    await page.evaluate(() => {
      (window as unknown as { stayed?: boolean }).stayed = true;
    });
    let loads = 0;
    page.on("load", () => {
      loads += 1;
    });

    await page.locator(`[data-slot="task-row"][data-task="${taskId}"] a`).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}(\\?tab=\\w+)?$`));
    await expect(page.locator('[data-slot="task-tabs"]')).toHaveAttribute("data-live", "");
    // The read is sent, held, and the bell has already dropped on the device.
    await expect
      .poll(() =>
        held.some(
          (request) => new URL(request.url()).pathname === "/api/notifications/read-record",
        ),
      )
      .toBe(true);
    await expect.poll(() => bellCount(page)).toBe(total - about);
    // Views tapped at once, while the receipt is still out.
    for (const view of ["work", "activity"]) {
      await page.locator(`[data-slot="task-tab"][data-view-tab="${view}"]`).click();
      await expect(page.locator(`[data-slot="task-tab"][data-view-tab="${view}"]`)).toHaveAttribute(
        "aria-current",
        "true",
      );
    }
    release();
    await expect.poll(() => unreadOf(staff)).toBe(total - about);
    // Every answer (the read, the live bell's count) landed and painted.
    await expect.poll(() => inFlight.size).toBe(0);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(
      await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed),
      "the page was never reloaded",
    ).toBe(true);
    expect(loads, "no document load after the task opened").toBe(0);
    expect(revalidated, "no read answers with a revalidation").toEqual([]);
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}\\?tab=activity$`));
    await expect(page.locator('[data-slot="task-tab"][data-view-tab="activity"]')).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect.poll(() => bellCount(page)).toBe(total - about);

    // The server's truth: a refresh shows the same count.
    await page.unroute("**/*");
    await page.reload();
    await hydrated(page);
    await expect.poll(() => bellCount(page)).toBe(total - about);
    await removeTasksTitled(prefix);
  });

  test("a background call sent while a page opens never holds it: the bell's count stays unanswered, the task opens (CI run 37118131079)", async ({
    page,
  }, info) => {
    // ARCHITECTURE §4.4. Next queues a server action sent during a navigation behind it and does
    // not commit the new page until the action answers: the bell's count, asked on the live
    // channel's first join, went out just after a tapped task's data arrived, and the task never
    // opened (CI run 37118131079). Here the channel's join waits for the tap and the task's data
    // waits until the count is out; the count is then never answered, nor is anything else the
    // app sends on its own (a server action, an /api/ call), and the task must still open.
    const staff = person(info, "staff");
    const prefix = `Background call ${info.project.name} `;
    await removeTasksTitled(prefix);
    await clearAlerts(staff);
    const staffId = await memberIdOf(staff);
    const taskId = await rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
      title: `${prefix}reel`,
      description: null,
      task_type_id: await taskTypeId("Normal"),
      client_id: null,
      priority: "medium",
      due_at: istInstant(addISTDays(todayIST(), 45), "18:00"),
      assignee_ids: [staffId],
      primary_owner_id: staffId,
      approving_admin_id: null,
      stages: [],
    });

    let tapped = false;
    let joinLetGo = () => {};
    const joinReleased = new Promise<void>((resolve) => {
      joinLetGo = resolve;
    });
    await page.routeWebSocket(/\/realtime\/v1\/websocket/, (socket) => {
      const server = socket.connectToServer();
      socket.onMessage(async (message) => {
        if (
          typeof message === "string" &&
          message.includes('"phx_join"') &&
          message.includes("realtime:notifications:")
        ) {
          await joinReleased;
        }
        server.send(message);
      });
    });
    // After the tap, whatever the app sends by itself is held, unanswered, to the end.
    const held: Request[] = [];
    const ended = new Set<Request>();
    page.on("requestfinished", (request) => ended.add(request));
    page.on("requestfailed", (request) => ended.add(request));
    let pageLetGo = () => {};
    const pageReleased = new Promise<void>((resolve) => {
      pageLetGo = resolve;
    });
    const countOut = page.waitForRequest(
      (request) =>
        tapped &&
        request.method() === "GET" &&
        new URL(request.url()).pathname === "/api/notifications/unread",
    );
    await page.route("**/*", async (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());
      const headers = request.headers();
      if (
        tapped &&
        ((request.method() === "POST" && headers["next-action"]) ||
          url.pathname.startsWith("/api/"))
      ) {
        held.push(request);
        return; // never answered
      }
      if (
        tapped &&
        headers["rsc"] === "1" &&
        !headers["next-router-prefetch"] &&
        url.pathname === `/tasks/${taskId}`
      ) {
        await pageReleased;
      }
      await route.fallback();
    });

    try {
      await signIn(page, staff, PASSWORD);
      await page.goto("/tasks");
      await hydrated(page);
      await expect(page.locator("html")).not.toHaveAttribute("data-live", "on");

      tapped = true;
      await page.locator(`[data-slot="task-row"][data-task="${taskId}"] a`).click();
      // The channel joins while the task's data is held: its count goes out mid-navigation.
      joinLetGo();
      const count = await countOut;
      pageLetGo();
      await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}(\\?tab=\\w+)?$`));
      await expect(page.locator('[data-slot="task-tabs"]')).toBeVisible();
      expect(held, "the count was held").toContain(count);
      expect(ended.has(count), "the count is still unanswered").toBe(false);
      // Opening the task sends its read receipt the same way: out, held, and the page is open.
      await expect
        .poll(() =>
          held.some(
            (request) => new URL(request.url()).pathname === "/api/notifications/read-record",
          ),
        )
        .toBe(true);
      expect(
        held.filter((request) => request.headers()["next-action"]),
        "no server action was sent without a tap",
      ).toEqual([]);
    } finally {
      joinLetGo();
      pageLetGo();
      if (!page.isClosed()) await page.unrouteAll({ behavior: "ignoreErrors" });
      await removeTasksTitled(prefix);
    }
  });

  test("an empty history says so", async ({ page }, info) => {
    const staff = person(info, "staff");
    await clearAlerts(staff);
    await signIn(page, staff, PASSWORD);
    await page.goto("/notifications");
    await expect(page.locator('[data-slot="empty-state"]')).toContainText("Nothing yet");
    await expect(page.locator('[data-slot="notification-bar"]')).toHaveCount(0);
  });

  test("5B: day groups, All | Unread, and a run about one record is one row that reads them all", async ({
    page,
  }, info) => {
    const staff = person(info, "staff");
    await clearAlerts(staff);
    const today = todayIST();
    const record = crypto.randomUUID();
    // Three comments about one record, early today (consecutive, one IST day): one row.
    for (const time of ["00:01", "00:02", "00:03"] as const) {
      await notify(staff, {
        kind: "task_comment",
        title: "Comment on Reel 9",
        link: "/leave/expenses",
        entity: "tasks",
        entityId: record,
        at: istInstant(today, time),
      });
    }
    await notify(staff, {
      title: "Leave approved",
      link: "/leave",
      read: true,
      at: istInstant(addISTDays(today, -1), "12:00"),
    });
    await notify(staff, { title: "An old one", at: istInstant(addISTDays(today, -10), "12:00") });
    await signIn(page, staff, PASSWORD);
    await page.goto("/notifications");
    await hydrated(page);

    await expect(page.locator('[data-slot="notification-group"] > h2')).toHaveText([
      "Today",
      "Yesterday",
      "Older",
    ]);
    const rows = page.locator('[data-slot="notification-row"]');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("3 comments on Reel 9");
    await expect(rows.nth(0)).toHaveAttribute("data-run", "3");
    await expect(rows.nth(0)).toHaveAttribute("data-unread", "true");
    await expect(page.locator('[data-slot="notification-bar"]')).toContainText("4 unread");
    await expect.poll(() => bellCount(page)).toBe(4);

    // The filter is view state: the address follows (replace), the read rows go.
    const filter = page.locator('[data-slot="alerts-filter"]');
    await filter.getByRole("link", { name: "Unread", exact: true }).click();
    await expect(page).toHaveURL(/\/notifications\?show=unread$/);
    await expect(filter.getByRole("link", { name: "Unread", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(rows).toHaveCount(2);
    await expect(rowOf(page, "Leave approved")).toHaveCount(0);
    await filter.getByRole("link", { name: "All", exact: true }).click();
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(rows).toHaveCount(3);

    // Opening the run reads all three, not only the newest.
    await rowOf(page, "3 comments on Reel 9").getByRole("link").click();
    await expect(page).toHaveURL(/\/leave\/expenses$/);
    await expect.poll(() => unreadOf(staff)).toBe(1);
    await expect.poll(() => bellCount(page)).toBe(1);
    await page.goto("/notifications");
    await expect(rowOf(page, "3 comments on Reel 9")).not.toHaveAttribute("data-unread");

    // Nothing unread: Unread says so, with the filter still there to go back.
    await page.locator('[data-slot="mark-all-read"]').click();
    await expect.poll(() => unreadOf(staff)).toBe(0);
    await page.goto("/notifications?show=unread");
    await expect(page.locator('[data-slot="empty-state"]')).toContainText("You're all caught up");
    await expect(page.locator('[data-slot="alerts-filter"]')).toBeVisible();
  });

  test("Realtime: a row written before the live channel first joins still reaches the bell and the list", async ({
    page,
  }, info) => {
    // Found 2026-10-02 (5B): a notification Realtime had already passed on before the page's
    // channel first joined sent that page no event, so the bell kept the old count until the next
    // navigation. Here the page's join is held until a listener of the test's own has heard the
    // row (Realtime has dealt with it), which makes that gap certain.
    const staff = person(info, "staff");
    await clearAlerts(staff);
    const { apikey } = supabaseAuth();
    const signedIn = await fetch(`${supabaseAuth().url}/token?grant_type=password`, {
      method: "POST",
      headers: { apikey, "content-type": "application/json" },
      body: JSON.stringify({ email: staff, password: PASSWORD }),
    });
    expect(signedIn.ok).toBe(true);
    const token = ((await signedIn.json()) as { access_token: string }).access_token;
    const listener = createClient(HOLD_PROXY_URL, apikey, { accessToken: async () => token });
    await listener.realtime.setAuth();
    const heard: string[] = [];
    await new Promise<void>((resolve, reject) => {
      listener
        .channel(`join-gap-${info.project.name}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications" },
          (change) => heard.push((change.new as { title?: string }).title ?? ""),
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") resolve();
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(status));
        });
    });

    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.routeWebSocket(/\/realtime\/v1\/websocket/, (socket) => {
      const server = socket.connectToServer();
      socket.onMessage(async (message) => {
        if (typeof message === "string" && message.includes('"phx_join"')) await released;
        server.send(message);
      });
    });
    try {
      await signIn(page, staff, PASSWORD);
      await page.goto("/notifications");
      await hydrated(page);
      await expect(page.locator('[data-slot="empty-state"]')).toContainText("Nothing yet");
      expect(await bellCount(page)).toBe(0);

      await notify(staff, { title: "Written before the join", link: "/leave" });
      await expect.poll(() => heard.includes("Written before the join")).toBe(true);
      release();
      await expect(page.locator("html")).toHaveAttribute("data-live", "on");
      await expect.poll(() => bellCount(page)).toBe(1);
      await expect(rowOf(page, "Written before the join")).toBeVisible();
    } finally {
      release();
      await listener.removeAllChannels();
      listener.realtime.disconnect();
    }
  });

  test("Realtime through the hold proxy: a new row and a read on another device reach the open screen, no reload", async ({
    page,
  }, info) => {
    const staff = person(info, "staff");
    await clearAlerts(staff);
    await signIn(page, staff, PASSWORD);
    await page.goto("/notifications");
    await hydrated(page);
    // The browser's Realtime socket goes to the build's Supabase URL: the hold proxy.
    await expect(page.locator("html")).toHaveAttribute("data-live", "on");
    await page.evaluate(() => {
      (window as unknown as { stayed?: boolean }).stayed = true;
    });

    const id = await notify(staff, { title: "Changes requested on Reel 4", link: "/tasks" });
    await expect(rowOf(page, "Changes requested on Reel 4")).toBeVisible();
    await expect(rowOf(page, "Changes requested on Reel 4")).toHaveAttribute("data-unread", "true");
    await expect.poll(() => bellCount(page)).toBe(1);

    // Read on another device: the receipt is an UPDATE event.
    await serviceUpdate(`notifications?id=eq.${id}`, { read_at: systemClock().toISOString() });
    await expect(rowOf(page, "Changes requested on Reel 4")).not.toHaveAttribute("data-unread");
    await expect.poll(() => bellCount(page)).toBe(0);

    expect(
      await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed),
      "the page was never reloaded",
    ).toBe(true);
  });

  test("Realtime sends a member their own rows only (RLS), with no filter of their own", async ({}, info) => {
    const staff = person(info, "staff");
    const admin = person(info, "admin");
    await clearAlerts(staff);
    await clearAlerts(admin);
    const { apikey } = supabaseAuth();
    const tokenOf = async (email: string) => {
      const answer = await fetch(`${supabaseAuth().url}/token?grant_type=password`, {
        method: "POST",
        headers: { apikey, "content-type": "application/json" },
        body: JSON.stringify({ email, password: PASSWORD }),
      });
      expect(answer.ok, `sign-in for ${email}`).toBe(true);
      return ((await answer.json()) as { access_token: string }).access_token;
    };
    type Heard = { recipient: string | null; title: string | null };
    const listen = async (email: string | null) => {
      const token = email ? await tokenOf(email) : null;
      // Through the hold proxy, as the browser connects; no `recipient_id` filter: only RLS.
      // Signed out (`null`): the publishable key alone, as anyone could connect.
      const client = token
        ? createClient(HOLD_PROXY_URL, apikey, { accessToken: async () => token })
        : createClient(HOLD_PROXY_URL, apikey);
      if (token) await client.realtime.setAuth();
      const heard: Heard[] = [];
      const hear = (record: unknown) => {
        const row = record as { recipient_id?: string; title?: string };
        heard.push({ recipient: row.recipient_id ?? null, title: row.title ?? null });
      };
      await new Promise<void>((resolve, reject) => {
        client
          .channel(`isolation-${email ?? "anon"}-${info.project.name}`)
          // Inserts and read receipts: what the app listens for. (A DELETE is not checked
          // against RLS by Realtime and carries the id alone; notifications are never deleted
          // outside the local fixtures, DATA-MODEL §9.)
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "notifications" },
            (change) => hear(change.new),
          )
          .on(
            "postgres_changes",
            { event: "UPDATE", schema: "public", table: "notifications" },
            (change) => hear(change.new),
          )
          .subscribe((status) => {
            if (status === "SUBSCRIBED") resolve();
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(status));
          });
      });
      return { client, heard };
    };
    const staffId = await memberIdOf(staff);
    const adminId = await memberIdOf(admin);
    const staffSide = await listen(staff);
    const adminSide = await listen(admin);
    const outsider = await listen(null);
    const forAdmin = `For the Admin only (${info.project.name})`;
    const forStaff = `For Staff only (${info.project.name})`;
    try {
      await notify(admin, { title: forAdmin });
      await notify(staff, { title: forStaff });
      await expect.poll(() => staffSide.heard.map((event) => event.title)).toContain(forStaff);
      await expect.poll(() => adminSide.heard.map((event) => event.title)).toContain(forAdmin);
      // Nothing else arrives late.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      // Other specs may tell this Admin about a suggestion meanwhile: every row heard is theirs.
      expect(staffSide.heard.filter((event) => event.recipient !== staffId)).toEqual([]);
      expect(adminSide.heard.filter((event) => event.recipient !== adminId)).toEqual([]);
      expect(staffSide.heard.map((event) => event.title)).not.toContain(forAdmin);
      expect(adminSide.heard.map((event) => event.title)).not.toContain(forStaff);
      // Someone signed out hears at most that a change happened, never a row.
      expect(
        outsider.heard.every((event) => event.recipient === null && event.title === null),
      ).toBe(true);
    } finally {
      await staffSide.client.removeAllChannels();
      await adminSide.client.removeAllChannels();
      await outsider.client.removeAllChannels();
    }
  });

  test("Admin: the bell carries the count; opening a record reads its rows", async ({
    page,
  }, info) => {
    const admin = person(info, "admin");
    const staffId = await memberIdOf(person(info, "staff"));
    await clearAlerts(admin);
    const about = await notify(admin, {
      title: "You now coordinate someone",
      link: `/people/${staffId}`,
      entity: "members",
      entityId: staffId,
    });
    await signIn(page, admin, PASSWORD);
    await page.goto("/today");
    await hydrated(page);
    // Other specs may tell every Admin about a suggestion meanwhile: the bell follows the rows.
    await expect.poll(async () => (await bellCount(page)) === (await unreadOf(admin))).toBe(true);
    expect(await bellCount(page)).toBeGreaterThan(0);

    await page.goto(`/people/${staffId}`);
    await expect
      .poll(
        async () => {
          const [row] = await serviceSelect<{ read_at: string | null }>(
            `notifications?id=eq.${about}&select=read_at`,
          );
          return row?.read_at ?? null;
        },
        { message: "opening the person reads the row about them" },
      )
      .not.toBeNull();
  });

  test("large text: the history fits at 130% and 200%", async ({ page, isMobile }, info) => {
    test.skip(!isMobile, "large system text is a phone rule");
    const staff = person(info, "staff");
    await clearAlerts(staff);
    await notify(staff, {
      title: "Your comp leave on Thursday 1 October was cancelled because it is now a holiday",
      body: "The credit is back. Choose another day from Attendance & leave when you want it.",
      link: "/leave",
    });
    await notify(staff, { title: "Done", minutesAgo: 60 * 24 * 400 });
    await signIn(page, staff, PASSWORD);
    await page.goto("/notifications");
    await hydrated(page);
    for (const scale of [100, 130, 200]) {
      await page.evaluate((percent) => {
        document.documentElement.style.fontSize = `${percent}%`;
      }, scale);
      await expectNoHorizontalScroll(page);
    }
  });

  test("installed, Staff: the title bar's bell, a row, back to its page's parent, then Alerts, then My Day", async ({
    page,
    isMobile,
  }, info) => {
    test.skip(!isMobile, "installed-mode back is a phone rule");
    const staff = person(info, "staff");
    await clearAlerts(staff);
    await notify(staff, { title: "Claim paid", link: "/leave/expenses" });
    await runInstalled(page);
    await signIn(page, staff, PASSWORD);
    await page.goto("/my-day");
    await hydrated(page);
    // The Crew's Alerts is the title bar's bell since 5B decision 1.
    await page.locator('[data-slot="header-bell"]:visible').click();
    await expect(page).toHaveURL(/\/notifications$/);
    await hydrated(page);
    await rowOf(page, "Claim paid").getByRole("link").click();
    await expect(page).toHaveURL(/\/leave\/expenses$/);
    await expectBackStack(page, [
      { url: /\/me$/ },
      { url: /\/notifications$/ },
      { url: /\/my-day$/ },
    ]);
  });

  test("installed, Staff: All | Unread never adds history; one back leaves Alerts", async ({
    page,
    isMobile,
  }, info) => {
    test.skip(!isMobile, "installed-mode back is a phone rule");
    const staff = person(info, "staff");
    await clearAlerts(staff);
    await notify(staff, { title: "Claim paid", link: "/leave/expenses" });
    await runInstalled(page);
    await signIn(page, staff, PASSWORD);
    await page.goto("/my-day");
    await hydrated(page);
    // The Crew's Alerts is the title bar's bell since 5B decision 1.
    await page.locator('[data-slot="header-bell"]:visible').click();
    await expect(page).toHaveURL(/\/notifications$/);
    await hydrated(page);
    const filter = page.locator('[data-slot="alerts-filter"]');
    for (const [name, url] of [
      ["Unread", /\/notifications\?show=unread$/],
      ["All", /\/notifications$/],
      ["Unread", /\/notifications\?show=unread$/],
    ] as const) {
      await filter.getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(url);
    }
    await expectBackStack(page, [{ url: /\/my-day$/ }]);
  });

  test("installed, Admin: the title bar's bell, a row, and back the same way", async ({
    page,
    isMobile,
  }, info) => {
    test.skip(!isMobile, "installed-mode back is a phone rule");
    const admin = person(info, "admin");
    const staffId = await memberIdOf(person(info, "staff"));
    await clearAlerts(admin);
    await notify(admin, {
      title: "A freelancer has no coordinator",
      link: `/people/${staffId}`,
    });
    await runInstalled(page);
    await signIn(page, admin, PASSWORD);
    await page.goto("/today");
    await hydrated(page);
    await page.locator('[data-slot="header-bell"]:visible').click();
    await expect(page).toHaveURL(/\/notifications$/);
    await hydrated(page);
    await rowOf(page, "A freelancer has no coordinator").getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/people/${staffId}$`));
    await expectBackStack(page, [
      { url: /\/people$/ },
      { url: /\/notifications$/ },
      { url: /\/today$/ },
    ]);
  });
});
