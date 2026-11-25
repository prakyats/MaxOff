import type { Page, TestInfo } from "@playwright/test";

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
  removeMonthSnapshots,
  rpcAs,
  rpcRefusedAs,
  runInstalled,
  serviceInsert,
  serviceSelect,
  serviceUpdate,
  storageStateFor,
  USERS,
} from "./helpers";
import { addISTDays, formatIST, istDayStart, todayIST } from "../src/core/time";
import { monthReminderAction } from "../src/modules/revenue/domain/month-reminder";

/**
 * The Owner's close screen (v3.5 "Month close", U4; PRODUCT §4.13, WORKFLOWS §7): Revenue → an
 * ended month's "Close month" → what is still waiting → "Close ‹Month› with N things still
 * waiting" → its confirmation → "Closed 3 Oct · v1". An Admin reopens a deliverable of that month
 * (allowed: R2), the Owner sees it under "Changed since close" with who did it, and corrects it
 * with a note (v2); a second correction with nothing different is refused "Nothing changed.".
 * **Admins and Crew get the not-allowed page and learn nothing about the month** (PERMISSIONS
 * "Month close").
 *
 * A month is closed once for the whole organisation, so each project closes **its own** month,
 * months back where no other spec writes (desktop 3, 375 px 4, 430 px 5; the installed tests 6
 * and 7), opened again first and last (`removeMonthSnapshots`, fixtures only: production never
 * reopens a month). Each test makes a client of its own (named for the test and the project).
 */

const owner = USERS.owner;
const admin = USERS.admin;

const today = todayIST();
const thisMonth = `${today.slice(0, 8)}01`;
/** The first day of the month `back` months before this IST month. */
function monthsBack(back: number): string {
  let start = thisMonth;
  for (let step = 0; step < back; step += 1) start = `${addISTDays(start, -1).slice(0, 8)}01`;
  return start;
}
const longMonth = (start: string) => formatIST(istDayStart(start), "MMMM yyyy");
const shortMonth = (start: string) => formatIST(istDayStart(start), "MMMM");
const slug = (start: string) => start.slice(0, 7);
const closedToday = formatIST(istDayStart(today), "d MMM");

/** Each project's own month (a close is the organisation's, so the projects never share one). */
const OWN_MONTH: Record<string, number> = { desktop: 3, mobile: 4, "mobile-lg": 5 };
const INSTALLED_MONTH: Record<string, number> = { mobile: 6, "mobile-lg": 7 };
const ownMonth = (info: TestInfo, table: Record<string, number>) => {
  const back = table[info.project.name];
  expect(back, `a month of its own for ${info.project.name}`).toBeDefined();
  return monthsBack(back!);
};

const nameOf = (info: TestInfo, what: string) => `Close ${what} (${info.project.name})`;

/** The last day of the month starting `start`. */
function lastDay(start: string): string {
  const next = `${addISTDays(start, 40).slice(0, 8)}01`;
  return addISTDays(next, -1);
}

/**
 * A client with a priced month M: a retainer whose cycle of M (inserted by the service role, as
 * the billing and client-work specs make a past cycle) has two plan deliverables at ₹20,000 for
 * the month, one of them done. So M is priced (closeable), its undecided deliverable is waiting
 * (Carry decisions), and the done one has a value an Admin's reopen moves.
 */
async function closeFixture(name: string, month: string) {
  await removeClientFixture(name);
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  const client = await serviceInsert<{ id: string }>("clients", {
    org_id: org?.id,
    name,
    admin_id: await memberIdOf(admin.email),
  });
  await rpcAs(owner.email, owner.password, "client_activate", { client_id: client.id });
  const projectId = await rpcAs<string>(admin.email, admin.password, "project_create", {
    client_id: client.id,
    name: "Close reels",
    recurrence: "monthly",
    stages: [],
    items: ["Current reel"],
  });
  const cycle = await serviceInsert<{ id: string }>("project_cycles", {
    org_id: org?.id,
    project_id: projectId,
    period_start: month,
    period_end: lastDay(month),
    label: longMonth(month),
    generated_by: "schedule",
  });
  const items: Record<string, string> = {};
  for (const [position, title] of [
    ["a0", "Reel A"],
    ["a1", "Reel B"],
  ] as const) {
    const item = await serviceInsert<{ id: string }>("project_items", {
      org_id: org?.id,
      project_id: projectId,
      cycle_id: cycle.id,
      origin_cycle_id: cycle.id,
      title,
      position,
    });
    // Part of that month's plan (a row written outside the cycle's list counts as added).
    await serviceUpdate(`item_billing?item_id=eq.${item.id}`, { added: false });
    items[title] = item.id;
  }
  await rpcAs(owner.email, owner.password, "billing_set_cycle_amount", {
    cycle_id: cycle.id,
    amount: 20000,
  });
  await rpcAs(admin.email, admin.password, "item_mark_done", { item_id: items["Reel A"] });
  return { clientId: client.id, projectId, cycleId: cycle.id, items };
}

const screen = (page: Page) => page.locator('[data-slot="month-close"]');
const closeButton = (page: Page) => page.locator('[data-slot="month-close-button"]');
const closeDialog = (page: Page, month: string) =>
  page.getByRole("dialog", { name: `Close ${shortMonth(month)}?` });
const correctDialog = (page: Page, month: string) =>
  page.getByRole("dialog", { name: `Correct ${shortMonth(month)}` });

/** Revenue at month M, then its header's link to the close screen. */
async function openFromRevenue(page: Page, month: string, label: string | RegExp) {
  await page.goto(`/reports/revenue?month=${slug(month)}`);
  await hydrated(page);
  await expect(page.locator('[data-slot="revenue-month-label"]')).toHaveText(longMonth(month));
  const link = page.locator('[data-slot="revenue-close-link"]');
  await expect(link).toHaveText(label);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/reports/close/${slug(month)}$`));
  await hydrated(page);
  await expectSettled(page);
}

test.describe("the Owner closes and corrects a month", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("close with things waiting, Changed since close after an Admin's reopen, correct to v2, Nothing changed", async ({
    page,
  }, info) => {
    const month = ownMonth(info, OWN_MONTH);
    const client = nameOf(info, "flow");
    await removeMonthSnapshots(month);
    const made = await closeFixture(client, month);
    try {
      // This month has no link (it hasn't ended); an ended month says "Close month".
      await page.goto("/reports/revenue");
      await hydrated(page);
      await expect(page.locator('[data-slot="revenue-close-link"]')).toHaveCount(0);
      await openFromRevenue(page, month, "Close month");

      // The waiting list: counts in plain words, each opening where it is settled; no amount.
      await expect(page.getByRole("heading", { name: "Month close", level: 1 })).toBeVisible();
      await expect(page.locator('[data-slot="month-close-month"]')).toHaveText(longMonth(month));
      await expect(screen(page)).toHaveAttribute("data-state", "open");
      const carry = page.locator(
        '[data-slot="month-close-waiting-row"][data-kind="carryDecisions"]',
      );
      await expect(carry).toContainText("Carry decisions");
      await expect(carry).toContainText("Ended cycles with deliverables");
      await expect(carry).toHaveAttribute("href", "/clients/items/decide");
      const count = Number(
        await carry.locator('[data-slot="month-close-waiting-count"]').textContent(),
      );
      expect(count).toBeGreaterThanOrEqual(1);
      await expect(page.locator('[data-slot="month-close-not-blocking"]')).toBeVisible();
      await expect(page.locator('[data-slot="month-close-waiting"]')).not.toContainText("₹");
      await expect(closeButton(page)).toHaveText(
        new RegExp(`^Close ${shortMonth(month)} with \\d+ things? still waiting$`),
      );
      await expectNoHorizontalScroll(page);

      // Close: the confirmation, then Closed ‹today› · v1 and nothing moved yet.
      await closeButton(page).click();
      const confirm = closeDialog(page, month);
      await expect(confirm).toBeVisible();
      await expect(confirm.locator('[data-slot="month-close-dialog-waiting"]')).toContainText(
        "still waiting",
      );
      await confirm
        .getByRole("button", { name: `Close ${shortMonth(month)}`, exact: true })
        .click();
      await expect(confirm).toBeHidden();
      await expect(screen(page)).toHaveAttribute("data-state", "closed");
      await expect(page.locator('[data-slot="month-close-closed"]')).toHaveText(
        `Closed ${closedToday} · v1`,
      );
      await expect(page.locator('[data-slot="month-close-version"]')).toHaveText(
        new RegExp(`^v1 · Closed ${closedToday}`),
      );
      await expect(page.locator('[data-slot="month-close-unchanged"]')).toContainText(
        "Nothing has moved.",
      );
      await expect(closeButton(page)).toHaveCount(0);

      // An Admin reopens the month's done deliverable (allowed after a close, R2).
      await rpcAs(admin.email, admin.password, "item_reopen", {
        item_id: made.items["Reel A"],
        reason: "Needs another pass",
      });
      const [adminRow] = await serviceSelect<{ full_name: string }>(
        `members?email=eq.${encodeURIComponent(admin.email)}&select=full_name`,
      );
      await page.reload();
      await hydrated(page);
      await expectSettled(page);
      await expectNoHorizontalScroll(page);
      const reel = page.locator('[data-slot="month-close-change"]', { hasText: "Reel A" });
      await expect(reel).toContainText("Reel A · Close reels");
      await expect(reel.locator('[data-slot="month-close-change-detail"]')).toHaveText(
        `Reopened by ${adminRow?.full_name}`,
      );
      await expect(
        reel.locator('[data-slot="month-close-change-figure"]', { hasText: "Achieved" }),
      ).toHaveText(/^Achieved ₹[\d,]+ → ₹0$/);
      // The cycle's own line moved too: no cause there, so no name; its amount stayed, so
      // "Figures changed", not "Amount changed".
      const cycleLine = page.locator('[data-slot="month-close-change"]', {
        hasText: `Close reels · ${client}`,
      });
      await expect(cycleLine.locator('[data-slot="month-close-change-detail"]')).toHaveText(
        "Figures changed",
      );
      // The month's totals that moved sit in one "Month total" row.
      const total = page.locator('[data-slot="month-close-total"]');
      await expect(total).toHaveCount(1);
      await expect(total).toContainText("Month total");
      await expect(
        total.locator('[data-slot="month-close-total-figure"]', { hasText: "Achieved" }),
      ).toHaveText(/^Achieved ₹[\d,]+ → ₹[\d,]+$/);
      // Still the saved report: the header still says v1.
      await expect(page.locator('[data-slot="month-close-closed"]')).toHaveText(
        `Closed ${closedToday} · v1`,
      );

      // Correct: the differences, the note's rule said inline, then v2 with the note.
      await page.locator('[data-slot="month-correct-button"]').click();
      const correct = correctDialog(page, month);
      await expect(correct).toBeVisible();
      await expect(
        correct.locator('[data-slot="month-close-change"]', { hasText: "Reel A" }),
      ).toBeVisible();
      const note = correct.getByRole("textbox", { name: "Why you're correcting it" });
      await note.fill("  too short ");
      await correct.getByRole("button", { name: "Save version 2" }).click();
      await expect(correct.locator('[data-slot="field-error"]')).toHaveText(
        "Write a note of 10 to 500 characters.",
      );
      await expect(note).toHaveAttribute("aria-invalid", "true");
      await expect(correct).toBeVisible();
      const reason = "Reel A was reopened after the close.";
      await note.fill(reason);
      await expect(correct.locator('[data-slot="field-error"]')).toHaveCount(0);
      await correct.getByRole("button", { name: "Save version 2" }).click();
      await expect(correct).toBeHidden();
      await expect(page.locator('[data-slot="month-close-closed"]')).toHaveText(
        `Closed ${closedToday} · v2`,
      );
      await expect(page.locator('[data-slot="month-close-version"]').first()).toContainText(
        `v2 · Corrected ${closedToday}`,
      );
      await expect(page.locator('[data-slot="month-close-version-note"]')).toHaveText(
        `Corrected: ${reason}`,
      );
      await expect(page.locator('[data-slot="month-close-unchanged"]')).toBeVisible();

      // Nothing different now: the function's refusal is said in the sheet, nothing is saved.
      await page.locator('[data-slot="month-correct-button"]').click();
      const again = correctDialog(page, month);
      await again
        .getByRole("textbox", { name: "Why you're correcting it" })
        .fill("Checking once more after the fix.");
      await again.getByRole("button", { name: "Save version 3" }).click();
      await expect(again.locator('[data-slot="form-alert"]')).toHaveText("Nothing changed.");
      await expect(again).toBeVisible();
      await again.getByRole("button", { name: "Cancel" }).click();
      await expect(again).toBeHidden();
      const versions = await serviceSelect<{ version: number }>(
        `month_snapshots?month=eq.${month}&select=version&order=version`,
      );
      expect(versions.map((row) => row.version)).toEqual([1, 2]);

      // Revenue's header now names the close; the header's back returns there (a sheet closed by
      // its own button leaves a spent entry, ARCHITECTURE §14.2, so the history back is the
      // installed test's, below).
      await page.locator('[data-slot="page-back"]:visible').click();
      await expect(page).toHaveURL(new RegExp(`/reports/revenue\\?month=${slug(month)}$`));
      await hydrated(page);
      await expect(page.locator('[data-slot="revenue-close-link"]')).toHaveText(
        `Closed ${closedToday} · v2`,
      );
    } finally {
      await removeMonthSnapshots(month);
      await removeClientFixture(client);
    }
  });

  test("a month that cannot be closed says why and has no button; a read that fails says so", async ({
    page,
  }) => {
    // This month has not ended.
    await page.goto(`/reports/close/${slug(thisMonth)}`);
    await hydrated(page);
    await expect(screen(page)).toHaveAttribute("data-state", "cannot");
    await expect(page.locator('[data-slot="month-close-reason"]')).toContainText(
      `${longMonth(thisMonth)} hasn't ended yet.`,
    );
    await expect(closeButton(page)).toHaveCount(0);
    // Long before anything was priced.
    await page.goto("/reports/close/2019-01");
    await hydrated(page);
    await expect(page.locator('[data-slot="month-close-reason"]')).toContainText(
      "Nothing to close.",
    );
    await expect(closeButton(page)).toHaveCount(0);
    // Not a month at all.
    await page.goto("/reports/close/2019-13");
    await expect(page.getByText("Page not found")).toBeVisible();
    await expect(screen(page)).toHaveCount(0);

    // The read fails (answered with an error at the proxy, for this test's own session).
    const session = await ownSession(page, owner.email, owner.password);
    const failing = await holdReads("/rest/v1/rpc/month_close_read", session, "jwt-expired");
    try {
      await page.goto(`/reports/close/${slug(monthsBack(9))}`);
      await hydrated(page);
      await expect(page.locator('[data-slot="month-close-error"]')).toContainText(
        "This month couldn't load.",
      );
      await expect(page.getByRole("heading", { name: "Month close", level: 1 })).toBeVisible();
      failing.release();
      await expect.poll(() => failing.active(), { message: "the read answers again" }).toBe(0);
      await page.getByRole("button", { name: "Try again" }).click();
      await expect(page.locator('[data-slot="month-close-error"]')).toHaveCount(0);
      await expect(page.locator('[data-slot="month-close-month"]')).toHaveText(
        longMonth(monthsBack(9)),
      );
    } finally {
      failing.release();
    }
  });
});

/** U5: each project's own month for the closed month on Revenue (none of the months above). */
const REVENUE_MONTH: Record<string, number> = { desktop: 8, mobile: 10, "mobile-lg": 11 };

test.describe("a closed month on the Revenue page (U5)", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("the saved figures after an Admin's change, Changed since close, billing at close and now, the money sheet's line", async ({
    page,
    browser,
  }, info) => {
    const month = ownMonth(info, REVENUE_MONTH);
    const client = nameOf(info, "revenue");
    await removeMonthSnapshots(month);
    const made = await closeFixture(client, month);
    // A deliverable added on top of the month's plan, not priced yet: its price sheet is a money sheet.
    const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
    await serviceInsert("project_items", {
      org_id: org?.id,
      project_id: made.projectId,
      cycle_id: made.cycleId,
      origin_cycle_id: made.cycleId,
      title: "Extra poster",
      position: "b0",
    });
    const projectPage = `/clients/${made.clientId}/projects/${made.projectId}?cycle=${made.cycleId}`;
    const card = page.locator('[data-slot="revenue-client"]', { hasText: client });
    const line = card.locator('[data-slot="revenue-line"]');
    const changed = page.locator('[data-slot="revenue-changed"]');
    const closedLine = `${shortMonth(month)} is closed. Its report changes only when you correct it.`;
    const priceSheet = page.getByRole("dialog", { name: "Set the price" });
    const priceRow = page.locator('[data-slot="billing-added-row"]', { hasText: "Extra poster" });
    try {
      // Before the close: the money sheet has no closed line, and Revenue reads live.
      await page.goto(projectPage);
      await hydrated(page);
      await priceRow.getByRole("button", { name: "Set price of Extra poster" }).click();
      await expect(priceSheet).toBeVisible();
      await expect(priceSheet.locator('[data-slot="billing-closed-month"]')).toBeHidden();
      await priceSheet.getByRole("button", { name: "Cancel" }).click();
      await expect(priceSheet).toBeHidden();
      await page.goto(`/reports/revenue?month=${slug(month)}`);
      await hydrated(page);
      await expect(page.locator('[data-slot="revenue"]')).not.toHaveAttribute("data-closed");
      // v2.5's Billed mark is on every line; an open month has nothing "at close".
      await expect(line.locator('[data-slot="revenue-line-billing"]')).toHaveText("Not billed");
      await expect(line.locator('[data-slot="revenue-line-billing-at-close"]')).toHaveCount(0);

      // Closed: the saved figures, one billing status, nothing moved.
      expect(await rpcAs<number>(owner.email, owner.password, "month_close", { month })).toBe(1);
      await page.reload();
      await hydrated(page);
      await expectSettled(page);
      await expect(page.locator('[data-slot="revenue"]')).toHaveAttribute("data-closed", "");
      await expect(page.locator('[data-slot="revenue-close-link"]')).toHaveText(
        `Closed ${closedToday} · v1`,
      );
      await expect(line.locator('[data-slot="revenue-line-figure"]')).toHaveText("₹20,000");
      await expect(line.locator('[data-slot="revenue-line-achieved"]')).toHaveText(
        "₹10,000 achieved",
      );
      await expect(line.locator('[data-slot="revenue-line-billing"]')).toHaveText("Not billed");
      await expect(line.locator('[data-slot="revenue-line-billing-at-close"]')).toHaveCount(0);
      await expect(changed).toHaveCount(0);
      await expectNoHorizontalScroll(page);

      // An Admin reopens the done deliverable: the page still shows the saved report, and says
      // that the live figures moved.
      await rpcAs(admin.email, admin.password, "item_reopen", {
        item_id: made.items["Reel A"],
        reason: "Needs another pass",
      });
      // The Owner marks the month's cycle billed after the close.
      await rpcAs(owner.email, owner.password, "billing_mark", {
        cycle_ids: [made.cycleId],
        billed: true,
        billed_on: null,
        note: null,
      });
      await page.reload();
      await hydrated(page);
      await expectSettled(page);
      await expect(line.locator('[data-slot="revenue-line-achieved"]')).toHaveText(
        "₹10,000 achieved",
      );
      // The Billed mark now (v2.5's), with the status at close beside it since they differ.
      await expect(line.locator('[data-slot="revenue-line-billing"]')).toHaveText(
        `Billed ${closedToday} · Not billed at close`,
      );
      await expect(line.locator('[data-slot="revenue-line-billing-at-close"]')).toHaveText(
        "· Not billed at close",
      );
      await expect(changed).toHaveText("Changed since close · See Month close");
      await expect(changed).toHaveAttribute("href", `/reports/close/${slug(month)}`);
      const [stored] = await serviceSelect<{ version: number }>(
        `month_snapshots?month=eq.${month}&select=version`,
      );
      expect(stored?.version, "the snapshot is not touched").toBe(1);
      await expectNoHorizontalScroll(page);
      await changed.click();
      await expect(page).toHaveURL(new RegExp(`/reports/close/${slug(month)}$`));
      await hydrated(page);
      await expect(page.locator('[data-slot="month-close-change"]').first()).toBeVisible();

      // The money sheet of a closed month says so, and saving still works.
      await page.goto(projectPage);
      await hydrated(page);
      await priceRow.getByRole("button", { name: "Set price of Extra poster" }).click();
      await expect(priceSheet.locator('[data-slot="billing-closed-month"]')).toHaveText(closedLine);
      await expectNoHorizontalScroll(page);
      await priceSheet.getByLabel("Price (₹)").fill("5000");
      await priceSheet.getByRole("button", { name: "Save price" }).click();
      await expect(priceSheet).toBeHidden();
      await expect(priceRow.locator('[data-slot="billing-price"]')).toHaveText("₹5,000");
      // Revenue still shows the saved Potential.
      await page.goto(`/reports/revenue?month=${slug(month)}`);
      await hydrated(page);
      await expect(line.locator('[data-slot="revenue-line-figure"]')).toHaveText("₹20,000");
      await expect(changed).toBeVisible();

      // The client's Admin opens the same project: no Billing, no word of the close.
      const context = await browser.newContext({ storageState: storageStateFor("admin") });
      try {
        const adminPage = await context.newPage();
        for (const headers of [undefined, { RSC: "1" }]) {
          const answer = await adminPage.request.get(projectPage, {
            ...(headers ? { headers } : {}),
          });
          expect(answer.ok()).toBe(true);
          const body = await answer.text();
          for (const secret of [
            "is closed",
            "Closed ",
            "billing-closed-month",
            "project-billing",
          ]) {
            expect(body.includes(secret), `the Admin's answer holds no "${secret}"`).toBe(false);
          }
        }
        await adminPage.goto(`/reports/revenue?month=${slug(month)}`);
        await expect(adminPage).toHaveURL(/\/forbidden/);
      } finally {
        await context.close();
      }
    } finally {
      await removeMonthSnapshots(month);
      await removeClientFixture(client);
    }
  });
});

test.describe("installed: the close screen (§14.2)", () => {
  test.skip(({ isMobile }) => !isMobile, "the installed app is a phone");
  test.use({ storageState: storageStateFor("owner") });

  test("back closes the confirmation and the correction, then returns to Revenue, then Today", async ({
    page,
  }, info) => {
    const month = ownMonth(info, INSTALLED_MONTH);
    const client = nameOf(info, "installed");
    await removeMonthSnapshots(month);
    await closeFixture(client, month);
    try {
      await runInstalled(page);
      await page.goto("/today");
      await hydrated(page);
      await openFromRevenue(page, month, "Close month");

      // The confirmation is a bottom sheet; back closes it and stays on the close screen.
      await closeButton(page).click();
      const confirm = closeDialog(page, month);
      await expect(confirm).toBeVisible();
      const box = await confirm.boundingBox();
      const viewport = page.viewportSize();
      expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBeGreaterThanOrEqual(
        (viewport?.height ?? 0) - 2,
      );
      await expectBackStack(page, [
        { closes: confirm, url: new RegExp(`/reports/close/${slug(month)}$`) },
      ]);

      // Close for real, then the correction's sheet: back closes it too.
      await closeButton(page).click();
      await closeDialog(page, month)
        .getByRole("button", { name: `Close ${shortMonth(month)}`, exact: true })
        .click();
      await expect(screen(page)).toHaveAttribute("data-state", "closed");
      await page.locator('[data-slot="month-correct-button"]').click();
      const correct = correctDialog(page, month);
      await expect(correct).toBeVisible();
      await expectBackStack(page, [
        { closes: correct, url: new RegExp(`/reports/close/${slug(month)}$`) },
        { url: new RegExp(`/reports/revenue\\?month=${slug(month)}$`) },
        { url: /\/today$/ },
      ]);
    } finally {
      await removeMonthSnapshots(month);
      await removeClientFixture(client);
    }
  });
});

/**
 * The reminder on Reports (v3.5 U6; decision 19, Q9; WORKFLOWS §7.3): from the 6th of the month
 * after M, the oldest month from the first priced month on that is not closed. Each project prices
 * a month further back than any other spec (desktop 12, 375 px 13, 430 px 14), so the first priced
 * month, and with it the line's month, is its own (whatever day of the month this runs: a month a
 * year back is always due; the 5th / 6th boundary is pgTAP 167's, at explicit instants). On a used
 * database with three workers another project's month can be older still, so the line's month is
 * asserted "at most this one", and its words against the month it names.
 */
const REMINDER_MONTH: Record<string, number> = { desktop: 12, mobile: 13, "mobile-lg": 14 };
const reminderLine = (page: Page) => page.locator('[data-slot="report-month-close"]');
const reminderWords = (month: string) =>
  new RegExp(
    `^${monthReminderAction({ month, more: 0 }, today).slice("Close ".length)}( and \\d+ more months?)? (isn't|aren't) closed yet$`,
  );

test.describe("the month close reminder on Reports (U6)", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("the oldest month not closed, opening its close screen; closed, it leaves the line", async ({
    page,
    isMobile,
  }, info) => {
    const month = ownMonth(info, REMINDER_MONTH);
    const client = nameOf(info, "reminder");
    await removeMonthSnapshots(month);
    await closeFixture(client, month);
    try {
      if (isMobile) await runInstalled(page);
      await page.goto("/today");
      await hydrated(page);
      await page.goto("/reports");
      await hydrated(page);
      await expectSettled(page);
      const line = reminderLine(page);
      await expect(line).toBeVisible();
      const named = `${(await line.getAttribute("data-month")) ?? ""}-01`;
      expect(named <= month, `the line names ${named}, at most ${month}`).toBe(true);
      await expect(line.locator('[data-slot="report-month-close-text"]')).toHaveText(
        reminderWords(named),
      );
      await expect(line).toContainText(monthReminderAction({ month: named, more: 0 }, today));
      await expect(line).toHaveAttribute("href", `/reports/close/${slug(named)}`);
      await expect(line).not.toContainText("₹");
      await expectNoHorizontalScroll(page);
      const box = await line.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

      // It opens that month's close screen; back returns to Reports, then Today (§14.2).
      await line.click();
      await expect(page).toHaveURL(new RegExp(`/reports/close/${slug(named)}$`));
      await hydrated(page);
      await expect(page.getByRole("heading", { name: "Month close", level: 1 })).toBeVisible();
      await expect(page.locator('[data-slot="month-close-month"]')).toHaveText(longMonth(named));
      await expectBackStack(page, [{ url: /\/reports$/ }, { url: /\/today$/ }]);

      // Closed, the month leaves the line: the next one comes up, or the line is gone.
      await rpcAs(owner.email, owner.password, "month_close", { month });
      await page.goto("/reports");
      await hydrated(page);
      await expectSettled(page);
      const after = reminderLine(page);
      if ((await after.count()) > 0) {
        await expect(after).not.toHaveAttribute("data-month", slug(month));
      }
      const next = await rpcAs<{ month: string; more: number } | null>(
        owner.email,
        owner.password,
        "month_close_reminder",
        {},
      );
      expect(next?.month ?? null).not.toBe(month);
    } finally {
      await removeMonthSnapshots(month);
      await removeClientFixture(client);
    }
  });
});

for (const role of ["admin", "staff"] as const) {
  test.describe(`${role === "admin" ? "An Admin" : "A Crew member"} and the close screen`, () => {
    test.use({ storageState: storageStateFor(role) });

    test("the not-allowed page, nothing of the month, and the read refused", async ({ page }) => {
      const user = USERS[role];
      const month = monthsBack(2);
      const refused = await rpcRefusedAs(user.email, user.password, "month_close_read", {
        month,
      });
      expect(refused.message).toBe("FORBIDDEN");
      expect(refused.details).toBe("Only the Owner sees a month's close.");
      const close = await rpcRefusedAs(user.email, user.password, "month_close", { month });
      expect(close.message).toBe("FORBIDDEN");

      await page.goto(`/reports/close/${slug(month)}`);
      await expect(page).toHaveURL(/\/forbidden/);
      await answerStartPrompt(page);
      await hydrated(page);
      await expect(screen(page)).toHaveCount(0);
      await expect(page.locator('[data-slot^="month-close"]')).toHaveCount(0);
      // A closed month's Revenue page (U5) is refused the same way.
      await page.goto(`/reports/revenue?month=${slug(month)}`);
      await expect(page).toHaveURL(/\/forbidden/);
      // Not a month at all answers the same way: nothing tells which months exist or are closed.
      await page.goto("/reports/close/2019-13");
      await expect(page).toHaveURL(/\/forbidden/);

      // The page's HTML and the router's payload hold nothing of the month's state.
      for (const headers of [undefined, { RSC: "1" }]) {
        const answer = await page.request.get(`/reports/close/${slug(month)}`, {
          ...(headers ? { headers } : {}),
          maxRedirects: 0,
        });
        const body = await answer.text();
        for (const secret of ["Closed ", "still waiting", "Still waiting", "₹", '"month-close"']) {
          expect(body.includes(secret), `the ${role}'s answer holds no "${secret}"`).toBe(false);
        }
      }
    });

    test("no month close reminder on Reports, in its HTML or payload; the read refused (U6)", async ({
      page,
    }, info) => {
      const user = USERS[role];
      // A priced month that is not closed (nine months back, where no other spec writes), so the
      // Owner would see the line: the Admin and Crew member must not.
      const month = monthsBack(9);
      const client = nameOf(info, `reminder ${role}`);
      await closeFixture(client, month);
      try {
        const refused = await rpcRefusedAs(user.email, user.password, "month_close_reminder", {});
        expect(refused.message).toBe("FORBIDDEN");
        expect(refused.details).toBe("Only the Owner sees which months are closed.");
        await page.goto("/reports");
        if (role === "staff") {
          await expect(page).toHaveURL(/\/forbidden/);
        } else {
          await hydrated(page);
          await expectSettled(page);
        }
        await expect(reminderLine(page)).toHaveCount(0);
        for (const headers of [undefined, { RSC: "1" }]) {
          const answer = await page.request.get("/reports", {
            ...(headers ? { headers } : {}),
            maxRedirects: 0,
          });
          const body = await answer.text();
          for (const secret of ["closed yet", "report-month-close", "/reports/close/"]) {
            expect(body.includes(secret), `the ${role}'s Reports holds no "${secret}"`).toBe(false);
          }
        }
      } finally {
        await removeClientFixture(client);
      }
    });
  });
}
