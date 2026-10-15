import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  hydrated,
  memberIdOf,
  patchAs,
  removeClientFixture,
  removeTasksTitled,
  rpcAs,
  serviceInsert,
  serviceSelect,
  storageStateFor,
  taskTypeId,
  USERS,
} from "./helpers";
import { promptSnoozeKey } from "../src/modules/attendance/domain/prompt";
import { addISTDays, istInstant, systemClock, todayIST } from "../src/core/time";

/**
 * Fresh data, no real time (ROADMAP 6b.17a, ARCHITECTURE "Freshness"): every change shows the
 * next time a screen is opened, shown again by back, or reloaded, for the person who made it and
 * for everyone else. Nothing here waits for Realtime: the person watching has no channel at all
 * (`noRealtime`), so what they see comes from their own navigation, never a push.
 *
 * One test per gap fixed in 6b.17a, and a sweep of the pairs that matter most and were already
 * fresh. "Another person" is a second browser context (or a second person acting through the
 * same database function or plain edit the app makes); waits are on visible state, never a sleep.
 */

// The service worker, once it controls the page, takes the router's fetches out of sight.
test.use({ storageState: storageStateFor("owner"), serviceWorkers: "block" });

const PREFIX = "Freshness ";

/** The person watching has no Realtime channel: nothing reaches their screen by itself. */
async function noRealtime(page: Page): Promise<void> {
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, () => {});
}

/** The app's own push, what a link does. */
async function drillIn(page: Page, href: string): Promise<void> {
  await page.evaluate((to) => {
    (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push(
      to,
    );
  }, href);
}

/** Text on the screen, in whichever layout this width draws. */
function shown(page: Page, text: string): Locator {
  return page.getByText(text, { exact: true }).filter({ visible: true }).first();
}

/** How many documents this page has loaded: a re-read in place loads none. */
function documentLoads(page: Page): Promise<number> {
  return page.evaluate(() => performance.getEntriesByType("navigation").length);
}

/** A task the Owner made for the seeded Crew member. */
async function crewTask(title: string): Promise<string> {
  await removeTasksTitled(title);
  const staffId = await memberIdOf(USERS.staff.email);
  return rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
    title,
    description: null,
    task_type_id: await taskTypeId("Normal"),
    client_id: null,
    priority: "medium",
    due_at: istInstant(addISTDays(todayIST(), 30), "18:00"),
    assignee_ids: [staffId],
    primary_owner_id: staffId,
    approving_admin_id: null,
    stages: [],
  });
}

/**
 * The Crew member on a second device, with today's Start-day prompt already seen (it would open
 * over the screen, and back closes it first), and no Realtime.
 */
async function crewDevice(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    storageState: storageStateFor("staff"),
    serviceWorkers: "block",
  });
  const key = promptSnoozeKey(await memberIdOf(USERS.staff.email), todayIST());
  await context.addInitScript(
    ({ storageKey, shownAt }) => window.localStorage.setItem(storageKey, String(shownAt)),
    { storageKey: key, shownAt: systemClock().getTime() },
  );
  const page = await context.newPage();
  await noRealtime(page);
  return { context, page };
}

/** Renames the task from its page, open already: ⋯ → Edit task → Title → Save changes. */
async function renameHere(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "Task actions" }).click();
  await page.getByRole("menuitem", { name: "Edit task" }).click();
  const dialog = page.locator('[data-slot="task-form-dialog"]');
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

/** The Owner, on their own device, renames a task from its page. */
async function ownerRenames(page: Page, taskId: string, title: string): Promise<void> {
  await page.goto(`/tasks/${taskId}`);
  await hydrated(page);
  await renameHere(page, title);
}

test.describe("the person who made the change", () => {
  test("a task renamed on its page shows on the list after back and after a reload", async ({
    page,
  }, info) => {
    const title = `${PREFIX}own ${info.project.name}`;
    const taskId = await crewTask(title);
    await page.goto("/tasks/all");
    await hydrated(page);
    await expect(shown(page, title)).toBeVisible();

    await drillIn(page, `/tasks/${taskId}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await renameHere(page, `${title} renamed`);

    await page.goBack();
    await expect(page).toHaveURL(/\/tasks\/all$/);
    await expect(shown(page, `${title} renamed`)).toBeVisible();
    await page.reload();
    await expect(shown(page, `${title} renamed`)).toBeVisible();
    await removeTasksTitled(title);
  });
});

test.describe("another person's change", () => {
  test("shows on a reload, and on the next open of a screen not seen since", async ({
    page,
    browser,
  }, info) => {
    const title = `${PREFIX}reload ${info.project.name}`;
    const taskId = await crewTask(title);
    const crew = await crewDevice(browser);
    await crew.page.goto("/tasks");
    await hydrated(crew.page);
    await expect(shown(crew.page, title)).toBeVisible();

    await ownerRenames(page, taskId, `${title} renamed`);

    await crew.page.reload();
    await expect(shown(crew.page, `${title} renamed`)).toBeVisible();
    await drillIn(crew.page, `/tasks/${taskId}`);
    await expect(crew.page.getByRole("heading", { name: `${title} renamed` })).toBeVisible();
    await crew.context.close();
    await removeTasksTitled(title);
  });

  // 6b.17a gap 1: Next restores a back from its history cache whatever its age, so a list left
  // for minutes came back without the change. Now a screen older than 30 s is re-read in place.
  test("shows when a screen older than 30 s is shown again by back", async ({
    page,
    browser,
  }, info) => {
    const title = `${PREFIX}back ${info.project.name}`;
    const taskId = await crewTask(title);
    const crew = await crewDevice(browser);
    await crew.page.clock.install();
    await crew.page.goto("/tasks");
    await hydrated(crew.page);
    await expect(shown(crew.page, title)).toBeVisible();
    await drillIn(crew.page, `/tasks/${taskId}`);
    await expect(crew.page.getByRole("heading", { name: title })).toBeVisible();

    await ownerRenames(page, taskId, `${title} renamed`);

    const loads = await documentLoads(crew.page);
    await crew.page.clock.fastForward(31_000);
    await crew.page.goBack();
    await expect(crew.page).toHaveURL(/\/tasks$/);
    await expect(shown(crew.page, `${title} renamed`)).toBeVisible();
    // In place: the list the router kept, then the change, never a reload.
    expect(await documentLoads(crew.page)).toBe(loads);
    await crew.context.close();
    await removeTasksTitled(title);
  });

  test("a task handed in by Crew is on the Owner's Approvals on a reload and the next open", async ({
    page,
  }, info) => {
    const title = `${PREFIX}approval ${info.project.name}`;
    const taskId = await crewTask(title);
    await noRealtime(page);
    await page.goto("/approvals");
    await hydrated(page);
    await expect(shown(page, title)).toBeHidden();

    await rpcAs(USERS.staff.email, USERS.staff.password, "task_submit_done", { task_id: taskId });

    await page.reload();
    await expect(shown(page, title)).toBeVisible();
    await drillIn(page, `/tasks/${taskId}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await removeTasksTitled(title);
  });

  test("a client renamed by its Admin shows on the Owner's Clients on a reload and the next open", async ({
    page,
  }, info) => {
    const name = `${PREFIX}client ${info.project.name}`;
    await removeClientFixture(name);
    await removeClientFixture(`${name} renamed`);
    const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
    const client = await serviceInsert<{ id: string }>("clients", {
      org_id: org?.id,
      name,
      admin_id: await memberIdOf(USERS.admin.email),
    });
    await rpcAs(USERS.owner.email, USERS.owner.password, "client_activate", {
      client_id: client.id,
    });
    await noRealtime(page);
    await page.goto("/clients");
    await hydrated(page);
    await expect(shown(page, name)).toBeVisible();

    await patchAs(USERS.admin.email, USERS.admin.password, `clients?id=eq.${client.id}`, {
      name: `${name} renamed`,
    });

    await page.reload();
    await expect(shown(page, `${name} renamed`)).toBeVisible();
    await drillIn(page, `/clients/${client.id}`);
    await expect(page.getByRole("heading", { name: `${name} renamed` })).toBeVisible();
    await removeClientFixture(`${name} renamed`);
  });

  // 6b.17a gap 2: a settings form kept the values it was first drawn with in its own state (and
  // its fields' defaults), so a re-read screen still showed what another device had replaced.
  test("a threshold saved on another device shows on the form once the screen is re-read", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "desktop", "an organisation setting: one project changes it");
    const [row] = await serviceSelect<{ org_id: string; overdue_escalate_hours: number }>(
      "org_settings?select=org_id,overdue_escalate_hours&limit=1",
    );
    expect(row, "the organisation's settings are seeded").toBeTruthy();
    const { org_id: orgId, overdue_escalate_hours: saved } = row as {
      org_id: string;
      overdue_escalate_hours: number;
    };
    const changed = saved === 47 ? 46 : 47;
    const settingsRow = `org_settings?org_id=eq.${orgId}`;
    const field = page.getByLabel("Overdue escalation (hours)");
    try {
      await noRealtime(page);
      await page.clock.install();
      await page.goto("/settings/thresholds");
      await hydrated(page);
      await expect(field).toHaveValue(String(saved));
      await drillIn(page, "/settings");
      await expect(page).toHaveURL(/\/settings$/);

      // The Owner on another device: the same plain edit the action makes.
      await patchAs(USERS.owner.email, USERS.owner.password, settingsRow, {
        overdue_escalate_hours: changed,
      });

      await page.clock.fastForward(31_000);
      await page.goBack();
      await expect(page).toHaveURL(/\/settings\/thresholds$/);
      await expect(field).toHaveValue(String(changed));
    } finally {
      await patchAs(USERS.owner.email, USERS.owner.password, settingsRow, {
        overdue_escalate_hours: saved,
      });
    }
  });
});
