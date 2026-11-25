import type { Locator, Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  answerStartPrompt,
  expectBackStack,
  expectNoHorizontalScroll,
  expectSettled,
  holdReads,
  hydrated,
  memberIdOf,
  ownSession,
  removeClientFixture,
  rpcAs,
  rpcRefusedAs,
  runInstalled,
  serviceInsert,
  serviceSelect,
  serviceUpdate,
  storageStateFor,
  USERS,
  watchReads,
} from "./helpers";
import { addISTDays, formatIST, istDayStart, todayIST } from "../src/core/time";

/**
 * The Owner's Revenue page (v2.1 "Money in", unit 9.2; WORKFLOWS §6): More → Reports → Revenue.
 * One IST month: Potential · Achieved · Remaining, the advances received apart, what needs a
 * look, and each client's lines, each opening its project. The month and the category are view
 * controls: they never add history. **An Admin has no Revenue row, lands on the not-allowed page
 * at its address, and no revenue read is ever sent for them** (invariant 2).
 *
 * The page lists every client's month, so each test makes a client of its own (named for the
 * test and the project, removed first and last) and reads only that client's card; the month's
 * totals at the top are other specs' too and are only checked for their shape.
 */

const owner = USERS.owner;
const admin = USERS.admin;
const nameOf = (info: TestInfo, what: string) => `Revenue ${what} (${info.project.name})`;

const today = todayIST();
const monthStart = `${today.slice(0, 8)}01`;
const lastMonthEnd = addISTDays(monthStart, -1);
const lastMonthStart = `${lastMonthEnd.slice(0, 8)}01`;
const monthLabel = (date: string) => formatIST(istDayStart(date), "MMMM yyyy");
const dayLabel = (date: string) => formatIST(istDayStart(date), "d MMM");

/** An Active client run by the seeded Admin. */
async function workClient(name: string): Promise<string> {
  await removeClientFixture(name);
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  const row = await serviceInsert<{ id: string }>("clients", {
    org_id: org?.id,
    name,
    admin_id: await memberIdOf(admin.email),
  });
  await rpcAs(owner.email, owner.password, "client_activate", { client_id: row.id });
  return row.id;
}

async function makeProject(
  clientId: string,
  name: string,
  options: { recurrence: "monthly" | "one_time"; items: string[]; delivery?: string },
): Promise<string> {
  return rpcAs<string>(admin.email, admin.password, "project_create", {
    client_id: clientId,
    name,
    recurrence: options.recurrence,
    stages: [],
    items: options.items,
    ...(options.delivery ? { delivery_date: options.delivery } : {}),
  });
}

const setAmount = (projectId: string, amount: number) =>
  rpcAs(owner.email, owner.password, "billing_set_project", {
    project_id: projectId,
    amount,
    set_amount: true,
    category: null,
  });

/**
 * A client with a month of revenue: a retainer at ₹30,000 with one of its three reels done and
 * one reel added and not priced, plus last month's cycle from before the amount (inserted by the
 * service role, as the client-work specs make an earlier cycle: no function makes a past one);
 * a one-time film at ₹60,000, past its delivery date, with ₹20,000 received today; and a
 * one-time project with no amount.
 */
async function revenueFixture(name: string) {
  const clientId = await workClient(name);
  const reels = await makeProject(clientId, "Rev reels", {
    recurrence: "monthly",
    items: ["Reel 1", "Reel 2", "Reel 3"],
  });
  const [cycle] = await serviceSelect<{ id: string; label: string }>(
    `project_cycles?project_id=eq.${reels}&select=id,label&limit=1`,
  );
  const [project] = await serviceSelect<{ org_id: string }>(
    `projects?id=eq.${reels}&select=org_id`,
  );
  await setAmount(reels, 30000);
  const earlier = await serviceInsert<{ id: string }>("project_cycles", {
    org_id: project?.org_id,
    project_id: reels,
    period_start: lastMonthStart,
    period_end: lastMonthEnd,
    label: monthLabel(lastMonthStart),
    generated_by: "schedule",
  });
  const [reel] = await serviceSelect<{ id: string }>(
    `project_items?project_id=eq.${reels}&title=eq.Reel%201&select=id`,
  );
  await rpcAs(admin.email, admin.password, "item_mark_done", { item_id: reel?.id });
  await rpcAs(admin.email, admin.password, "item_add", { cycle_id: cycle?.id, title: "Extra" });

  const film = await makeProject(clientId, "Rev film", {
    recurrence: "one_time",
    items: ["Film"],
    delivery: addISTDays(today, 5),
  });
  await setAmount(film, 60000);
  await rpcAs(owner.email, owner.password, "advance_record", {
    project_id: film,
    amount: 20000,
    received_on: today,
    note: null,
  });
  // Past its date (a fixture's date moved back: no function sets one in the past).
  const due = addISTDays(today, -2);
  await serviceUpdate(`projects?id=eq.${film}`, { delivery_date: due });

  const unpriced = await makeProject(clientId, "Rev unpriced", {
    recurrence: "one_time",
    items: ["Poster"],
    delivery: today,
  });
  return { clientId, reels, cycle: cycle!, earlier: earlier.id, film, due, unpriced };
}

const report = (page: Page) => page.locator('[data-slot="revenue"]');
const card = (page: Page, client: string) =>
  page.locator('[data-slot="revenue-client"]', { hasText: client });
const line = (scope: Locator, project: string) =>
  scope.locator('[data-slot="revenue-line"]', { hasText: project });
const exception = (page: Page, client: string, words: string | RegExp) =>
  page.locator('[data-slot="revenue-exception"]', { hasText: client }).filter({ hasText: words });

test.describe("the Owner's Revenue page", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("the month's figures by client, what needs a look, and a line opens its project", async ({
    page,
  }, info) => {
    const client = nameOf(info, "month");
    const made = await revenueFixture(client);
    try {
      // Reports lists Revenue for the Owner; the row opens the page.
      await page.goto("/reports");
      await hydrated(page);
      await page.locator('[data-slot="report-link"]', { hasText: "Revenue" }).first().click();
      await expect(page).toHaveURL(/\/reports\/revenue$/);
      await hydrated(page);
      await expectSettled(page);
      await expect(page.locator('[data-slot="revenue-month-label"]')).toHaveText(monthLabel(today));

      // The month's three figures and the advances, apart.
      for (const figure of ["potential", "achieved", "remaining"]) {
        await expect(page.locator(`[data-slot="revenue-${figure}"] dd`)).toHaveText(/^₹[\d,.]+$/);
      }
      await expect(page.locator('[data-slot="revenue-advances"]')).toContainText(
        /Advances received ₹[\d,]+/,
      );

      // This client's card: its totals and its three lines.
      const mine = card(page, client);
      await expect(mine).toContainText("Potential ₹90,000 · Achieved ₹10,000 · Remaining ₹80,000");
      const reels = line(mine, "Rev reels");
      await expect(reels.locator('[data-slot="revenue-line-status"]')).toHaveText(
        `${made.cycle.label} · 1 of 4 done`,
      );
      await expect(reels.locator('[data-slot="revenue-line-figure"]')).toHaveText("₹30,000");
      await expect(reels.locator('[data-slot="revenue-line-achieved"]')).toHaveText(
        "₹10,000 achieved",
      );
      await expect(reels.locator('[data-slot="revenue-line-notes"]')).toHaveText("1 not priced");
      const film = line(mine, "Rev film");
      await expect(film.locator('[data-slot="revenue-line-status"]')).toHaveText(
        `Was due ${dayLabel(made.due)}`,
      );
      await expect(film.locator('[data-slot="revenue-line-figure"]')).toHaveText("₹60,000");
      await expect(film.locator('[data-slot="revenue-line-notes"]')).toHaveText("Advance ₹20,000");
      const unpriced = line(mine, "Rev unpriced");
      await expect(unpriced.locator('[data-slot="revenue-line-figure"]')).toHaveText(
        "No amount set",
      );

      // Needs a look: each exception names the client and the project.
      await expect(page.getByRole("heading", { name: "Needs a look" })).toBeVisible();
      await expect(exception(page, client, "No amount set")).toContainText("Rev unpriced");
      await expect(exception(page, client, "1 not priced")).toContainText("Rev reels");
      await expect(exception(page, client, `Was due ${dayLabel(made.due)}`)).toContainText(
        "Rev film",
      );
      await expectNoHorizontalScroll(page);

      // An added deliverable priced on top shows as "+₹… added" and joins Potential.
      const [extra] = await serviceSelect<{ id: string }>(
        `project_items?project_id=eq.${made.reels}&title=eq.Extra&select=id`,
      );
      await rpcAs(owner.email, owner.password, "item_value_set", {
        item_id: extra?.id,
        value: 2718,
      });
      await page.reload();
      await hydrated(page);
      await expect(reels.locator('[data-slot="revenue-line-notes"]')).toHaveText("+₹2,718 added");
      await expect(reels.locator('[data-slot="revenue-line-figure"]')).toHaveText("₹32,718");
      await expect(exception(page, client, /not priced/)).toHaveCount(0);

      // A retainer's line opens the project at that cycle, on its Billing section.
      await reels.click();
      await expect(page).toHaveURL(
        new RegExp(`/clients/${made.clientId}/projects/${made.reels}\\?cycle=${made.cycle.id}`),
      );
      await expect(page.locator('[data-slot="project-billing"]')).toBeVisible();
      await expect(
        page.locator('[data-slot="project-billing"] [data-slot="billing-potential"] dd'),
      ).toHaveText("₹32,718");
      // One back returns to the Revenue page.
      await page.goBack();
      await expect(page).toHaveURL(/\/reports\/revenue$/);
    } finally {
      await removeClientFixture(client);
    }
  });

  test("the month switcher and the category filter recompute the page and add no history", async ({
    page,
  }, info) => {
    const client = nameOf(info, "controls");
    await revenueFixture(client);
    try {
      await page.goto("/reports");
      await hydrated(page);
      await page.locator('[data-slot="report-link"]', { hasText: "Revenue" }).first().click();
      await expect(page).toHaveURL(/\/reports\/revenue$/);
      await hydrated(page);
      await expectSettled(page);
      const entries = await page.evaluate(() => history.length);
      const filter = page.locator('[data-slot="revenue-filter"]');
      const mine = card(page, client);
      await expect(filter.getByRole("link", { name: "All", exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );

      // Project: only the one-time lines, and the card's totals are theirs.
      await filter.getByRole("link", { name: "Project", exact: true }).click();
      await expect(page).toHaveURL(/\/reports\/revenue\?category=project$/);
      await expect(filter.getByRole("link", { name: "Project", exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(line(mine, "Rev film")).toBeVisible();
      await expect(line(mine, "Rev reels")).toHaveCount(0);
      await expect(mine).toContainText("Potential ₹60,000 · Achieved ₹0 · Remaining ₹60,000");
      await expect(exception(page, client, /not priced/)).toHaveCount(0);

      // Retainer: the cycle alone; no advances line belongs to a retainer.
      await filter.getByRole("link", { name: "Retainer", exact: true }).click();
      await expect(page).toHaveURL(/\/reports\/revenue\?category=retainer$/);
      await expect(line(mine, "Rev reels")).toBeVisible();
      await expect(line(mine, "Rev film")).toHaveCount(0);
      await expect(mine).toContainText("Potential ₹30,000 · Achieved ₹10,000 · Remaining ₹20,000");
      await expect(page.locator('[data-slot="revenue-advances"]')).toHaveCount(0);

      // Additional Work: this client has none, so no card of its own.
      await filter.getByRole("link", { name: "Additional Work", exact: true }).click();
      await expect(page).toHaveURL(/category=additional_work$/);
      await expect(mine).toHaveCount(0);

      // Last month, all categories: the cycle from before the first amount, "No amount set".
      await filter.getByRole("link", { name: "All", exact: true }).click();
      await expect(page).toHaveURL(/\/reports\/revenue$/);
      await page.getByRole("link", { name: "Previous month" }).click();
      await expect(page).toHaveURL(
        new RegExp(`/reports/revenue\\?month=${lastMonthStart.slice(0, 7)}$`),
      );
      await expect(page.locator('[data-slot="revenue-month-label"]')).toHaveText(
        monthLabel(lastMonthStart),
      );
      const earlier = line(mine, "Rev reels");
      await expect(earlier.locator('[data-slot="revenue-line-figure"]')).toHaveText(
        "No amount set",
      );
      await expect(exception(page, client, "No amount set")).toContainText(
        `Rev reels · ${monthLabel(lastMonthStart)}`,
      );
      await page.getByRole("link", { name: "Next month" }).click();
      await expect(page.locator('[data-slot="revenue-month-label"]')).toHaveText(monthLabel(today));
      await expectNoHorizontalScroll(page);

      // Seven view changes later: not one history entry more, and one back leaves the page.
      expect(await page.evaluate(() => history.length)).toBe(entries);
      await page.goBack();
      await expect(page).toHaveURL(/\/reports$/);
    } finally {
      await removeClientFixture(client);
    }
  });

  test("a month with nothing says so; a read that fails says so and Try again re-reads", async ({
    page,
  }) => {
    // Far before anything exists: the empty state, with the figures at zero.
    await page.goto("/reports/revenue?month=2019-01");
    await hydrated(page);
    await expect(page.locator('[data-slot="revenue-month-label"]')).toHaveText("January 2019");
    await expect(report(page).locator('[data-slot="empty-state"]')).toHaveText(
      "No revenue this month.",
    );
    await expect(page.locator('[data-slot="revenue-potential"] dd')).toHaveText("₹0");
    await expect(page.getByRole("heading", { name: "By client" })).toHaveCount(0);

    // The read fails (answered with an error at the proxy, for this test's own session).
    const session = await ownSession(page, owner.email, owner.password);
    const failing = await holdReads("/rest/v1/rpc/revenue_month_read", session, "jwt-expired");
    try {
      await page.goto("/reports/revenue");
      await hydrated(page);
      await expect(page.locator('[data-slot="revenue-error"]')).toContainText(
        "Revenue couldn't load.",
      );
      await expect(page.locator('[data-slot="error-state"]')).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Revenue", level: 1 })).toBeVisible();
      await expect(report(page)).not.toContainText("₹");
      const entries = await page.evaluate(() => history.length);
      failing.release();
      await expect.poll(() => failing.active(), { message: "the read answers again" }).toBe(0);
      await page.getByRole("button", { name: "Try again" }).click();
      await expect(page.locator('[data-slot="revenue-figures"]')).toBeVisible();
      await expect(page.locator('[data-slot="revenue-error"]')).toHaveCount(0);
      expect(await page.evaluate(() => history.length)).toBe(entries);
    } finally {
      failing.release();
    }
  });
});

test.describe("installed: the Revenue page (§14.2)", () => {
  test.skip(({ isMobile }) => !isMobile, "the installed app is a phone");
  test.use({ storageState: storageStateFor("owner") });

  test("the month and the category never add an entry: back leaves to Reports, then Today", async ({
    page,
  }, info) => {
    const client = nameOf(info, "installed");
    await revenueFixture(client);
    try {
      await runInstalled(page);
      await page.goto("/today");
      await page.goto("/reports");
      await hydrated(page);
      await page.locator('[data-slot="report-link"]', { hasText: "Revenue" }).first().click();
      await expect(page).toHaveURL(/\/reports\/revenue$/);
      await hydrated(page);
      const filter = page.locator('[data-slot="revenue-filter"]');
      await filter.getByRole("link", { name: "Project", exact: true }).click();
      await expect(page).toHaveURL(/category=project$/);
      await page.getByRole("link", { name: "Previous month" }).click();
      await expect(page).toHaveURL(/month=\d{4}-\d{2}&category=project$/);
      await filter.getByRole("link", { name: "All", exact: true }).click();
      await expect(page).toHaveURL(/month=\d{4}-\d{2}$/);
      await expectBackStack(page, [{ url: /\/reports$/ }, { url: /\/today$/ }]);
    } finally {
      await removeClientFixture(client);
    }
  });
});

test.describe("an Admin and the Revenue page", () => {
  test.use({ storageState: storageStateFor("admin") });

  test("no Revenue row on Reports, the address is not allowed, and no revenue read is sent", async ({
    page,
  }, info) => {
    const client = nameOf(info, "admin");
    const made = await revenueFixture(client);
    // Not vacuous: the Owner's read holds this client's lines, and the function refuses the Admin.
    const read = await rpcAs<{ cycles: { client_id: string }[] }>(
      owner.email,
      owner.password,
      "revenue_month_read",
      {},
    );
    expect(read.cycles.some((cycle) => cycle.client_id === made.clientId)).toBe(true);
    const refused = await rpcRefusedAs(admin.email, admin.password, "revenue_month_read", {});
    expect(refused.message).toBe("FORBIDDEN");

    const session = await ownSession(page, admin.email, admin.password);
    const watch = await watchReads(session);
    try {
      // Reports is the Admin's work report: no list of the Owner's reports, no Revenue.
      await page.goto("/reports");
      await answerStartPrompt(page);
      await hydrated(page);
      // The loading screen traces the period control (its own `report-period`, §14.1), and React
      // streams the page in hidden (`<div hidden id="S:…">`) before its batched `$RC` reveal: until
      // the swap both are in the DOM, one of them hidden. Settled first, then the strict locator.
      await expectSettled(page);
      await expect(page.locator('[data-slot="report-period"]')).toBeVisible();
      await expect(page.locator('[data-slot="report-link"]')).toHaveCount(0);
      await expect(page.getByRole("link", { name: /Revenue/ })).toHaveCount(0);
      await expect(page.locator('a[href^="/reports/revenue"]')).toHaveCount(0);

      // The address itself: the not-allowed page, with nothing of the Revenue page.
      await page.goto("/reports/revenue");
      await expect(page).toHaveURL(/\/forbidden/);
      await hydrated(page);
      await expect(report(page)).toHaveCount(0);
      await expect(page.locator('[data-slot^="revenue-"]')).toHaveCount(0);
      await page.goto("/reports/revenue?month=2026-10&category=project");
      await expect(page).toHaveURL(/\/forbidden/);

      // The page's HTML and the router's payload for that address hold no line of the month.
      for (const headers of [undefined, { RSC: "1" }]) {
        const answer = await page.request.get("/reports/revenue", {
          ...(headers ? { headers } : {}),
          maxRedirects: 0,
        });
        const body = await answer.text();
        // (The loading screen's header may be in it: the page's name and its fixed line, never a
        // figure, a client or a row of the month.)
        for (const secret of [
          client,
          "Rev reels",
          "Rev film",
          "30,000",
          "60,000",
          "₹",
          '"revenue-client"',
          '"revenue-line"',
        ]) {
          expect(body.includes(secret), `the Admin's answer holds no "${secret}"`).toBe(false);
        }
      }

      // The server asked the database for the Admin's screens, never for revenue.
      const reads = watch.server();
      expect(reads.length, "the watch is live").toBeGreaterThan(0);
      expect(
        reads.filter((path) => /revenue|billing|advance|item_value/.test(path)),
        "no money read on the Admin's requests",
      ).toEqual([]);
    } finally {
      watch.stop();
      await removeClientFixture(client);
    }
  });
});
