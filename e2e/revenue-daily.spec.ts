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
 * v2.5 "Revenue every day" (kickoff 9 R3, R5, Q3, Q7, decisions 6 and 7; WORKFLOWS §6, §9): the
 * Owner's Billing section gains Billed / Not billed, Adjust with "System calculated" beside the
 * Owner's figure, the planned deliverables' own values and Billing history; the Revenue page
 * gains "On hold ₹X" inside Remaining, Billed on every line and "Mark all N billed"; Today ends
 * with the month's line, its amounts masked until tapped; and the Owner's notification about an
 * unpriced deliverable opens the right cycle's Billing. **An Admin sees none of it: no amount, no
 * ₹, and no billing or revenue read on any of their requests** (invariant 2).
 *
 * Every client is named for its test and the Playwright project, removed first and last
 * (`removeClientFixture` removes its billing rows too). The Revenue page's month is shared by
 * every spec, so the Revenue tests use a month of their own, years ahead, one per project.
 */

const owner = USERS.owner;
const admin = USERS.admin;
const nameOf = (info: TestInfo, what: string) => `Daily ${what} (${info.project.name})`;

const today = todayIST();
const day = (date: string) => formatIST(istDayStart(date), "d MMM");
const monthLabel = (date: string) => formatIST(istDayStart(date), "MMMM yyyy");

/** The first day of the month `by` months from the month of `start` (plain calendar arithmetic). */
function shiftMonth(start: string, by: number): string {
  const index = Number(start.slice(0, 4)) * 12 + (Number(start.slice(5, 7)) - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}
const monthFromNow = (by: number) => shiftMonth(today, by);
/** The last day of the month that starts on `start`. */
const monthEnd = (start: string) => addISTDays(shiftMonth(start, 1), -1);

/** A month of this project's own, years ahead: no other spec has a line in it. */
const OWN_MONTH: Record<string, number> = { desktop: 40, mobile: 41, "mobile-lg": 42 };
const ownMonth = (info: TestInfo) => monthFromNow(OWN_MONTH[info.project.name] ?? 43);

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
  options: { recurrence?: "monthly" | "one_time"; items: string[]; delivery?: string },
): Promise<string> {
  return rpcAs<string>(admin.email, admin.password, "project_create", {
    client_id: clientId,
    name,
    recurrence: options.recurrence ?? "monthly",
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

/** The project's cycle (a new project has one: this month's). */
async function cycleOf(projectId: string): Promise<{ id: string; label: string }> {
  const [cycle] = await serviceSelect<{ id: string; label: string }>(
    `project_cycles?project_id=eq.${projectId}&select=id,label&order=period_start.desc&limit=1`,
  );
  expect(cycle, "the project's cycle").toBeTruthy();
  return cycle!;
}

/**
 * A retainer's cycle for another month, with one planned deliverable (no function makes a cycle
 * out of its schedule, so the service role inserts it, as the client-work specs do; its
 * deliverable is marked part of that month's plan, since a row written outside the cycle's own
 * list counts as added on top).
 */
async function cycleIn(
  projectId: string,
  start: string,
  title = "Planned reel",
): Promise<{ id: string; label: string }> {
  const [project] = await serviceSelect<{ org_id: string }>(
    `projects?id=eq.${projectId}&select=org_id`,
  );
  const label = monthLabel(start);
  const cycle = await serviceInsert<{ id: string }>("project_cycles", {
    org_id: project?.org_id,
    project_id: projectId,
    period_start: start,
    period_end: monthEnd(start),
    label,
    generated_by: "schedule",
  });
  const item = await serviceInsert<{ id: string }>("project_items", {
    org_id: project?.org_id,
    project_id: projectId,
    cycle_id: cycle.id,
    origin_cycle_id: cycle.id,
    title,
    position: "a0",
  });
  await serviceUpdate(`item_billing?item_id=eq.${item.id}`, { added: false });
  return { id: cycle.id, label };
}

const section = (page: Page) => page.locator('[data-slot="project-billing"]');
const row = (page: Page, slot: string) => section(page).locator(`[data-slot="${slot}"]`);
const valueOf = (locator: Locator) => locator.locator('[data-slot="billing-value"]');
const sheet = (page: Page, title: string) => page.getByRole("dialog", { name: title });
const fieldError = (dialog: Locator) => dialog.locator('[data-slot="field-error"]');
const historyRows = (page: Page) =>
  row(page, "billing-history").locator('[data-slot="billing-history-what"]');

async function openProject(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await hydrated(page);
  await expectSettled(page);
  await expect(section(page)).toBeVisible();
}

test.describe("the Owner's Billing section, v2.5", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("a retainer: Mark billed with its day and note, back to Not billed; Adjust and Back to calculated", async ({
    page,
  }, info) => {
    const name = nameOf(info, "retainer");
    const clientId = await workClient(name);
    try {
      const projectId = await makeProject(clientId, "Daily reels", { items: ["Reel 1", "Reel 2"] });
      await setAmount(projectId, 40000);
      const [reel] = await serviceSelect<{ id: string }>(
        `project_items?project_id=eq.${projectId}&title=eq.Reel%201&select=id`,
      );
      // One reel approved: ₹20,000 calculated.
      await rpcAs(admin.email, admin.password, "item_mark_done", { item_id: reel?.id });
      await rpcAs(owner.email, owner.password, "item_approve", { item_ids: [reel?.id] });
      await openProject(page, `/clients/${clientId}/projects/${projectId}`);

      // Billed: "Not billed" until marked; the sheet's day is today and cannot be in the future.
      const billed = row(page, "billing-billed");
      await expect(valueOf(billed)).toHaveText("Not billed");
      // (Checked before any toast: a toast sliding in is not the page.)
      await expectNoHorizontalScroll(page);
      await billed.getByRole("button", { name: "Mark billed" }).click();
      const mark = sheet(page, "Mark billed");
      await expect(mark).toBeVisible();
      const date = mark.getByLabel("Date billed");
      await expect(date).toHaveValue(today);
      await expect(date).toHaveAttribute("max", today);
      await mark.getByLabel("Note (optional)").fill("Invoice 42");
      await mark.getByRole("button", { name: "Mark billed" }).click();
      await expect(mark).toBeHidden();
      await expect(valueOf(billed)).toHaveText(`Billed on ${day(today)} · Invoice 42`);
      await billed.getByRole("button", { name: "Mark not billed" }).click();
      const unmark = sheet(page, "Mark not billed");
      await expect(unmark).toContainText(`Billed on ${day(today)} · Invoice 42`);
      await unmark.getByRole("button", { name: "Mark not billed" }).click();
      await expect(unmark).toBeHidden();
      await expect(valueOf(billed)).toHaveText("Not billed");

      // Adjust: the note is required; the Owner's figure, with the system's beside it.
      const adjust = row(page, "billing-adjust");
      await expect(adjust).toContainText("Achieved");
      await expect(valueOf(adjust)).toHaveText("₹20,000");
      await expect(adjust.locator('[data-slot="billing-adjust-detail"]')).toHaveText(
        "As calculated from approved work",
      );
      await adjust.getByRole("button", { name: "Adjust achieved" }).click();
      const set = sheet(page, "Adjust achieved");
      await expect(set).toContainText("System calculated ₹20,000");
      await set.getByLabel("Achieved (₹)").fill("18000");
      await set.getByRole("button", { name: "Save adjustment" }).click();
      await expect(fieldError(set)).toHaveText("Add a note saying why.");
      await set.getByLabel("Note", { exact: true }).fill("Agreed discount");
      await set.getByRole("button", { name: "Save adjustment" }).click();
      await expect(set).toBeHidden();
      await expect(adjust).toHaveAttribute("data-adjusted", "true");
      await expect(adjust).toContainText("Owner adjusted · Agreed discount");
      await expect(valueOf(adjust)).toHaveText("₹18,000");
      await expect(adjust.locator('[data-slot="billing-adjust-detail"]')).toHaveText(
        "System calculated ₹20,000",
      );
      // The headline Achieved is the Owner's figure; Remaining follows it.
      await expect(row(page, "billing-achieved").locator("dd")).toHaveText("₹18,000");
      await expect(row(page, "billing-remaining").locator("dd")).toHaveText("₹22,000");

      // Back to calculated, with its own required note.
      await adjust.getByRole("button", { name: "Back to calculated" }).click();
      const clear = sheet(page, "Back to calculated");
      await expect(clear).toContainText("₹18,000");
      await clear.getByRole("button", { name: "Back to calculated" }).click();
      await expect(fieldError(clear)).toHaveText("Add a note saying why.");
      await clear.getByLabel("Note", { exact: true }).fill("Paid in full after all");
      await clear.getByRole("button", { name: "Back to calculated" }).click();
      await expect(clear).toBeHidden();
      await expect(adjust).toHaveAttribute("data-adjusted", "false");
      await expect(valueOf(adjust)).toHaveText("₹20,000");
      await expect(row(page, "billing-achieved").locator("dd")).toHaveText("₹20,000");
    } finally {
      await removeClientFixture(name);
    }
  });

  test("a planned deliverable's own value off the top, a refusal said plainly, and back to its share", async ({
    page,
  }, info) => {
    const name = nameOf(info, "planned");
    const clientId = await workClient(name);
    try {
      const projectId = await makeProject(clientId, "Daily planned", {
        items: ["Reel 1", "Reel 2", "Reel 3"],
      });
      await setAmount(projectId, 30000);
      await openProject(page, `/clients/${clientId}/projects/${projectId}`);

      // Collapsed to one row; opening it is a view control (no history entry).
      const planned = row(page, "billing-planned");
      await expect(planned.locator('[data-slot="billing-planned-toggle"]')).toContainText(
        "Planned deliverables · 3",
      );
      await expect(planned.locator('[data-slot="billing-planned-row"]').first()).toBeHidden();
      const entries = await page.evaluate(() => history.length);
      await planned.locator('[data-slot="billing-planned-toggle"]').click();
      expect(await page.evaluate(() => history.length)).toBe(entries);
      const value = (title: string) =>
        planned
          .locator('[data-slot="billing-planned-row"]', { hasText: title })
          .locator('[data-slot="billing-planned-value"]');
      for (const title of ["Reel 1", "Reel 2", "Reel 3"]) {
        await expect(value(title)).toHaveText("₹10,000 · Share");
      }
      // The open list fits (checked before any toast: a toast sliding in is not the page).
      await expectNoHorizontalScroll(page);

      // Reel 1's own value comes off the top; the others share the rest.
      await planned.getByRole("button", { name: "Set value of Reel 1" }).click();
      const set = sheet(page, "Set the value");
      await expect(set).toContainText("this month's ₹30,000");
      await set.getByLabel("Value of Reel 1 (₹)").fill("12000");
      await set.getByRole("button", { name: "Save value" }).click();
      await expect(set).toBeHidden();
      await expect(value("Reel 1")).toHaveText("₹12,000 · Own value");
      await expect(value("Reel 2")).toHaveText("₹9,000 · Share");
      await expect(value("Reel 3")).toHaveText("₹9,000 · Share");

      // More than the amount: the function's refusal, said in the sheet; nothing changes.
      await planned.getByRole("button", { name: "Set value of Reel 2" }).click();
      const over = sheet(page, "Set the value");
      await over.getByLabel("Value of Reel 2 (₹)").fill("25000");
      await over.getByRole("button", { name: "Save value" }).click();
      await expect(over.locator('[data-slot="form-alert"]')).toContainText(
        "add up to more than this cycle's amount",
      );
      await over.getByRole("button", { name: "Cancel" }).click();
      await expect(over).toBeHidden();
      await expect(value("Reel 2")).toHaveText("₹9,000 · Share");

      // Back to share.
      await planned.getByRole("button", { name: "Back to share: Reel 1" }).click();
      const share = sheet(page, "Back to share");
      await expect(share).toContainText("₹12,000");
      await share.getByRole("button", { name: "Back to share" }).click();
      await expect(share).toBeHidden();
      for (const title of ["Reel 1", "Reel 2", "Reel 3"]) {
        await expect(value(title)).toHaveText("₹10,000 · Share");
      }
    } finally {
      await removeClientFixture(name);
    }
  });

  test("a one-time project: Billed and Not billed; Adjust only once completed, System calculated beside it", async ({
    page,
  }, info) => {
    const name = nameOf(info, "one-time");
    const clientId = await workClient(name);
    try {
      const projectId = await makeProject(clientId, "Daily film", {
        recurrence: "one_time",
        items: ["Film"],
        delivery: addISTDays(today, 10),
      });
      await setAmount(projectId, 60000);
      const path = `/clients/${clientId}/projects/${projectId}`;
      await openProject(page, path);
      const billed = row(page, "billing-billed");
      await expect(valueOf(billed)).toHaveText("Not billed");
      // Working: nothing achieved yet, so nothing to adjust.
      await expect(row(page, "billing-adjust")).toHaveCount(0);
      await billed.getByRole("button", { name: "Mark billed" }).click();
      const mark = sheet(page, "Mark billed");
      await expect(mark).toContainText("this project");
      await mark.getByRole("button", { name: "Mark billed" }).click();
      await expect(mark).toBeHidden();
      await expect(valueOf(billed)).toHaveText(`Billed on ${day(today)}`);
      await billed.getByRole("button", { name: "Mark not billed" }).click();
      await sheet(page, "Mark not billed").getByRole("button", { name: "Mark not billed" }).click();
      await expect(valueOf(billed)).toHaveText("Not billed");

      // Completed: the lump sum is Achieved, and it can be adjusted.
      const [film] = await serviceSelect<{ id: string }>(
        `project_items?project_id=eq.${projectId}&select=id`,
      );
      await rpcAs(owner.email, owner.password, "item_mark_done_and_complete", {
        item_id: film?.id,
      });
      await openProject(page, path);
      const adjust = row(page, "billing-adjust");
      await expect(valueOf(adjust)).toHaveText("₹60,000");
      await adjust.getByRole("button", { name: "Adjust achieved" }).click();
      const set = sheet(page, "Adjust achieved");
      await set.getByLabel("Achieved (₹)").fill("55000");
      await set.getByLabel("Note", { exact: true }).fill("Late delivery discount");
      await set.getByRole("button", { name: "Save adjustment" }).click();
      await expect(set).toBeHidden();
      await expect(valueOf(adjust)).toHaveText("₹55,000");
      await expect(adjust.locator('[data-slot="billing-adjust-detail"]')).toHaveText(
        "System calculated ₹60,000",
      );
    } finally {
      await removeClientFixture(name);
    }
  });

  test("Billing history lists the changes newest first, re-reads when one is made, and Show older loads more", async ({
    page,
  }, info) => {
    const name = nameOf(info, "history");
    const clientId = await workClient(name);
    try {
      const projectId = await makeProject(clientId, "Daily history", {
        items: ["Reel 1", "Reel 2"],
      });
      const cycle = await cycleOf(projectId);
      const [reel] = await serviceSelect<{ id: string }>(
        `project_items?project_id=eq.${projectId}&title=eq.Reel%201&select=id`,
      );
      await setAmount(projectId, 40000);
      await rpcAs(owner.email, owner.password, "billing_mark", {
        cycle_ids: [cycle.id],
        billed: true,
        billed_on: today,
        note: "Invoice 7",
      });
      await rpcAs(owner.email, owner.password, "revenue_override_set", {
        scope: "cycle",
        ref_id: cycle.id,
        adjusted_value: 9000,
        note: "Discount",
      });
      await rpcAs(owner.email, owner.password, "item_value_set", {
        item_id: reel?.id,
        value: 10000,
      });
      const path = `/clients/${clientId}/projects/${projectId}`;
      await openProject(page, path);

      // Closed, it reads nothing: the request goes only when it opens.
      const asked: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/api/revenue/billing-history")) asked.push(request.url());
      });
      const history = row(page, "billing-history");
      await expect(history.locator('[data-slot="billing-history-body"]')).toHaveCount(0);
      const entries = await page.evaluate(() => window.history.length);
      await history.locator('[data-slot="billing-history-toggle"]').click();
      await expect(historyRows(page)).toHaveText([
        "Price of Reel 1 set to ₹10,000",
        `${cycle.label}: adjusted to ₹9,000: Discount`,
        `${cycle.label}: marked billed on ${day(today)}: Invoice 7`,
        "Amount set to ₹40,000",
        `${cycle.label}: amount set to ₹40,000`,
      ]);
      expect(asked.length, "one read as it opened").toBe(1);
      expect(await page.evaluate(() => window.history.length)).toBe(entries);
      // Each line names who made the change (the Owner, by name) and when, in IST.
      const [me] = await serviceSelect<{ full_name: string }>(
        `members?email=eq.${encodeURIComponent(owner.email)}&select=full_name`,
      );
      await expect(history.locator('[data-slot="billing-history-row"]').first()).toContainText(
        new RegExp(`^\\d{1,2} \\w{3} \\d{4}, \\d{1,2}:\\d{2} [ap]m · ${me?.full_name}`),
      );
      // Few changes: no "Show older".
      await expect(history.locator('[data-slot="billing-history-older"]')).toHaveCount(0);

      // A change made in the section shows at the top of the open history.
      await row(page, "billing-billed").getByRole("button", { name: "Mark not billed" }).click();
      await sheet(page, "Mark not billed").getByRole("button", { name: "Mark not billed" }).click();
      await expect(historyRows(page).first()).toHaveText(`${cycle.label}: marked not billed`);

      // Twenty-five more changes: the newest 20 first, then "Show older" for the rest.
      for (let n = 1; n <= 25; n += 1) {
        await rpcAs(owner.email, owner.password, "billing_set_cycle_amount", {
          cycle_id: cycle.id,
          amount: 40000 + n,
        });
      }
      await openProject(page, path);
      await row(page, "billing-history").locator('[data-slot="billing-history-toggle"]').click();
      await expect(historyRows(page)).toHaveCount(20);
      await expect(historyRows(page).first()).toHaveText(
        `${cycle.label}: amount set to ₹40,025 (was ₹40,024)`,
      );
      const older = row(page, "billing-history").locator('[data-slot="billing-history-older"]');
      await expect(older).toHaveText("Show older");
      const before = await page.evaluate(() => window.history.length);
      await older.click();
      await expect(historyRows(page)).toHaveCount(31);
      await expect(historyRows(page).last()).toHaveText(`${cycle.label}: amount set to ₹40,000`);
      await expect(older).toHaveCount(0);
      expect(await page.evaluate(() => window.history.length)).toBe(before);
      await expectNoHorizontalScroll(page);
    } finally {
      await removeClientFixture(name);
    }
  });

  test("the Owner's notification about an unpriced deliverable opens that cycle's Billing", async ({
    page,
  }, info) => {
    const name = nameOf(info, "notify");
    const clientId = await workClient(name);
    try {
      const project = `Daily notified ${info.project.name}`;
      const projectId = await makeProject(clientId, project, { items: ["Reel 1"] });
      await setAmount(projectId, 40000);
      // Next month's cycle (made ahead by the service role): the link must open it, not this one.
      const next = await cycleIn(projectId, monthFromNow(1));
      await rpcAs(admin.email, admin.password, "item_add", {
        cycle_id: next.id,
        title: "Late extra",
      });
      await page.goto("/notifications");
      await hydrated(page);
      const notice = page
        .locator('[data-slot="notification-row"]')
        .filter({ hasText: `${project}: a deliverable isn't priced` });
      await expect(notice).toHaveCount(1);
      await expect(notice).toContainText(`"Late extra" was added to ${next.label}.`);
      await expect(notice).not.toContainText("₹");
      await notice.getByRole("link").click();
      await expect(page).toHaveURL(
        new RegExp(
          `/clients/${clientId}/projects/${projectId}\\?cycle=${next.id}#project-billing$`,
        ),
      );
      await hydrated(page);
      await expect(section(page)).toBeVisible();
      await expect(row(page, "billing-cycle")).toContainText(next.label);
      const added = section(page).locator('[data-slot="billing-added-row"]', {
        hasText: "Late extra",
      });
      await expect(added.locator('[data-slot="billing-price"]')).toHaveText("Not priced");
      // The address's anchor is the section's own heading.
      await expect(section(page).locator("h2#project-billing")).toHaveText("Billing");
    } finally {
      await removeClientFixture(name);
    }
  });
});

test.describe("the Revenue page, v2.5", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("On hold inside Remaining, Billed on every line, and Mark all N billed", async ({
    page,
  }, info) => {
    const name = nameOf(info, "month");
    const clientId = await workClient(name);
    const month = ownMonth(info);
    try {
      // A retainer on hold with a cycle in this test's month (₹30,000, nothing done), and a
      // one-time film due in it (₹60,000).
      const reels = await makeProject(clientId, "Daily held reels", { items: ["Reel 1"] });
      await setAmount(reels, 30000);
      await cycleIn(reels, month);
      await rpcAs(owner.email, owner.password, "project_hold", {
        project_id: reels,
        reason: "Client paused the account",
      });
      const film = await makeProject(clientId, "Daily far film", {
        recurrence: "one_time",
        items: ["Film"],
        delivery: `${month.slice(0, 8)}10`,
      });
      await setAmount(film, 60000);

      await page.goto(`/reports/revenue?month=${month.slice(0, 7)}`);
      await hydrated(page);
      await expectSettled(page);
      await expect(page.locator('[data-slot="revenue-month-label"]')).toHaveText(monthLabel(month));
      await expect(page.locator('[data-slot="revenue-potential"] dd')).toHaveText("₹90,000");
      await expect(page.locator('[data-slot="revenue-remaining"] dd').first()).toHaveText(
        "₹90,000",
      );
      await expect(page.locator('[data-slot="revenue-on-hold"]')).toHaveText("On hold ₹30,000");
      const card = page.locator('[data-slot="revenue-client"]', { hasText: name });
      await expect(card).toContainText("Remaining ₹90,000 (On hold ₹30,000)");
      const line = (project: string) =>
        card.locator('[data-slot="revenue-line"]', { hasText: project });
      await expect(
        line("Daily held reels").locator('[data-slot="revenue-line-billing"]'),
      ).toHaveText("Not billed");
      await expect(line("Daily far film").locator('[data-slot="revenue-line-billing"]')).toHaveText(
        "Not billed",
      );
      await expectNoHorizontalScroll(page);

      // Mark all 2 billed: a confirm sheet, then the list re-reads.
      const markAll = page.locator('[data-slot="revenue-mark-all"]');
      await expect(markAll).toContainText("2 lines not billed yet");
      await markAll.getByRole("button", { name: "Mark all 2 billed" }).click();
      const confirm = sheet(page, "Mark all 2 billed");
      await expect(confirm).toContainText(monthLabel(month));
      await expect(confirm.getByLabel("Date billed")).toHaveValue(today);
      await confirm.getByRole("button", { name: "Mark 2 billed" }).click();
      await expect(confirm).toBeHidden();
      for (const project of ["Daily held reels", "Daily far film"]) {
        await expect(line(project).locator('[data-slot="revenue-line-billing"]')).toHaveText(
          `Billed ${day(today)}`,
        );
      }
      await expect(markAll).toHaveCount(0);

      // An adjusted line says so.
      const [filmCycle] = await serviceSelect<{ id: string }>(
        `project_cycles?project_id=eq.${film}&select=id`,
      );
      expect(filmCycle, "the film's one cycle").toBeTruthy();
      const [reelCycle] = await serviceSelect<{ id: string }>(
        `project_cycles?project_id=eq.${reels}&period_start=eq.${month}&select=id`,
      );
      await rpcAs(owner.email, owner.password, "revenue_override_set", {
        scope: "cycle",
        ref_id: reelCycle?.id,
        adjusted_value: 5000,
        note: "Part paid",
      });
      await page.reload();
      await hydrated(page);
      await expect(
        line("Daily held reels").locator('[data-slot="revenue-line-adjusted"]'),
      ).toHaveText("· Adjusted");
      await expect(
        line("Daily far film").locator('[data-slot="revenue-line-adjusted"]'),
      ).toHaveCount(0);
    } finally {
      await removeClientFixture(name);
    }
  });
});

test.describe("the Owner's Today line", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("at the end of Today, its amounts masked until tapped; the tap adds no history and is not kept", async ({
    page,
  }) => {
    await page.goto("/today");
    await hydrated(page);
    const line = page.locator('[data-slot="today-revenue"]');
    await expect(line).toBeVisible();
    const month = formatIST(istDayStart(today), "MMMM");
    const masked = line.locator('[data-slot="today-revenue-masked"]');
    const figures = line.locator('[data-slot="today-revenue-figures"]');
    await expect(masked).toBeVisible();
    await expect(figures).toBeHidden();
    const words = (await masked.innerText()).trim();
    expect(words).toMatch(new RegExp(`^${month} · ₹ ••• achieved of ₹ •••`));
    // Masked: no figure at all, only the counts that need a look.
    expect(words.replace(/ · \d+ (not priced|with no amount)/g, "")).not.toMatch(/\d/);

    // The last thing on Today: below the main column and This week, on every width.
    const top = (await line.boundingBox())!.y;
    for (const part of ['[data-slot="owner-today"]', '[data-slot="day-week"]']) {
      const box = await page.locator(part).first().boundingBox();
      if (box)
        expect(box.y + box.height, `${part} ends above the line`).toBeLessThanOrEqual(top + 1);
    }

    // A tap shows the figures: no history entry.
    const entries = await page.evaluate(() => history.length);
    await line.locator('[data-slot="today-revenue-toggle"]').click();
    await expect(figures).toBeVisible();
    await expect(masked).toBeHidden();
    await expect(figures).toHaveText(
      new RegExp(
        `^${month} · ₹[\\d,.]+ achieved of ₹[\\d,.]+( · \\d+ not priced)?( · \\d+ with no amount)?`,
      ),
    );
    expect(await page.evaluate(() => history.length)).toBe(entries);
    // A second tap masks them again.
    await line.locator('[data-slot="today-revenue-toggle"]').click();
    await expect(masked).toBeVisible();
    await line.locator('[data-slot="today-revenue-toggle"]').click();
    await expect(figures).toBeVisible();
    // Not kept: a reload starts masked.
    await page.reload();
    await hydrated(page);
    await expect(page.locator('[data-slot="today-revenue-masked"]')).toBeVisible();
    await expect(page.locator('[data-slot="today-revenue-figures"]')).toBeHidden();

    // "Open Revenue" drills into the Revenue page; back returns to Today.
    await page.locator('[data-slot="today-revenue-open"]').click();
    await expect(page).toHaveURL(/\/reports\/revenue$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/today$/);
  });

  test("the line streams after the page behind a fallback that traces it", async ({ page }) => {
    const session = await ownSession(page, owner.email, owner.password);
    const held = await holdReads("/rest/v1/rpc/revenue_month_totals", session);
    try {
      await page.goto("/today", { waitUntil: "commit" });
      const fallback = page.locator('[data-slot="today-revenue-skeleton"]');
      // The page is in (its first section) while the line still waits.
      await expect(fallback).toBeVisible();
      await expect(page.locator('[data-slot="today-attendance-card"]').first()).toBeVisible();
      await expect.poll(() => held.caught(), { message: "the totals read is held" }).toBe(true);
      const box = await fallback.boundingBox();
      held.release();
      const line = page.locator('[data-slot="today-revenue"]');
      await expect(line).toBeVisible();
      await expect(fallback).toHaveCount(0);
      const settled = await line.boundingBox();
      expect(box).not.toBeNull();
      expect(settled).not.toBeNull();
      expect(
        Math.abs(settled!.y - box!.y),
        "the line takes the fallback's place",
      ).toBeLessThanOrEqual(1);
      expect(Math.abs(settled!.x - box!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(settled!.width - box!.width)).toBeLessThanOrEqual(1);
      // One row high at least, as the fallback (a long masked line may wrap below it: it is last).
      expect(box!.height).toBeGreaterThanOrEqual(64);
      expect(settled!.height).toBeGreaterThanOrEqual(box!.height - 1);
    } finally {
      held.release();
    }
  });
});

test.describe("installed: v2.5's sheets and parts (§14.2)", () => {
  test.skip(({ isMobile }) => !isMobile, "the installed app is a phone");
  test.use({ storageState: storageStateFor("owner") });

  test("a retainer: back closes Mark billed, Adjust, Set value and Back to share in turn; the parts add no entry", async ({
    page,
  }, info) => {
    const name = nameOf(info, "installed");
    const clientId = await workClient(name);
    try {
      const projectId = await makeProject(clientId, "Daily back", { items: ["Reel 1", "Reel 2"] });
      await setAmount(projectId, 40000);
      const [reel] = await serviceSelect<{ id: string }>(
        `project_items?project_id=eq.${projectId}&title=eq.Reel%201&select=id`,
      );
      await rpcAs(owner.email, owner.password, "item_value_set", {
        item_id: reel?.id,
        value: 15000,
      });
      const path = `/clients/${clientId}/projects/${projectId}`;
      const here = new RegExp(`${path}$`);
      await runInstalled(page);
      await page.goto("/today");
      await page.goto(path);
      await hydrated(page);
      await expect(section(page)).toBeVisible();

      await row(page, "billing-billed").getByRole("button", { name: "Mark billed" }).click();
      const mark = sheet(page, "Mark billed");
      await expect(mark).toBeVisible();
      await expectBackStack(page, [{ closes: mark, url: here }]);

      await row(page, "billing-adjust").getByRole("button", { name: "Adjust achieved" }).click();
      const adjust = sheet(page, "Adjust achieved");
      await expect(adjust).toBeVisible();
      await expectBackStack(page, [{ closes: adjust, url: here }]);

      // Opening the planned list and the history adds no entry: the next back closes the sheet.
      await row(page, "billing-planned").locator('[data-slot="billing-planned-toggle"]').click();
      await row(page, "billing-history").locator('[data-slot="billing-history-toggle"]').click();
      await expect(historyRows(page).first()).toBeVisible();
      await row(page, "billing-planned")
        .getByRole("button", { name: "Set value of Reel 2" })
        .click();
      const set = sheet(page, "Set the value");
      await expect(set).toBeVisible();
      await expectBackStack(page, [{ closes: set, url: here }]);

      await row(page, "billing-planned")
        .getByRole("button", { name: "Back to share: Reel 1" })
        .click();
      const share = sheet(page, "Back to share");
      await expect(share).toBeVisible();
      // Backing out changes nothing, and the next back leaves the project.
      await expectBackStack(page, [{ closes: share, url: here }, { url: /\/today$/ }]);
      const read = await rpcAs<{
        items: { title: string; method: string }[];
        cycle: { billing_status: string };
      }>(owner.email, owner.password, "project_billing_read", {
        project_id: projectId,
        cycle_id: (await cycleOf(projectId)).id,
      });
      expect(read.cycle.billing_status).toBe("not_billed");
      expect(read.items.find((item) => item.title === "Reel 1")?.method).toBe("explicit");
    } finally {
      await removeClientFixture(name);
    }
  });

  test("Mark not billed and Back to calculated close on back, then the project is left", async ({
    page,
  }, info) => {
    const name = nameOf(info, "installed undo");
    const clientId = await workClient(name);
    try {
      const projectId = await makeProject(clientId, "Daily back undo", { items: ["Reel 1"] });
      await setAmount(projectId, 40000);
      const cycle = await cycleOf(projectId);
      await rpcAs(owner.email, owner.password, "billing_mark", {
        cycle_ids: [cycle.id],
        billed: true,
        billed_on: today,
        note: null,
      });
      await rpcAs(owner.email, owner.password, "revenue_override_set", {
        scope: "cycle",
        ref_id: cycle.id,
        adjusted_value: 1000,
        note: "Token",
      });
      const path = `/clients/${clientId}/projects/${projectId}`;
      const here = new RegExp(`${path}$`);
      await runInstalled(page);
      await page.goto("/today");
      await page.goto(path);
      await hydrated(page);
      await row(page, "billing-billed").getByRole("button", { name: "Mark not billed" }).click();
      const unmark = sheet(page, "Mark not billed");
      await expect(unmark).toBeVisible();
      await expectBackStack(page, [{ closes: unmark, url: here }]);
      await row(page, "billing-adjust").getByRole("button", { name: "Back to calculated" }).click();
      const clear = sheet(page, "Back to calculated");
      await expect(clear).toBeVisible();
      await expectBackStack(page, [{ closes: clear, url: here }, { url: /\/today$/ }]);
      const read = await rpcAs<{ cycle: { billing_status: string; override: unknown } }>(
        owner.email,
        owner.password,
        "project_billing_read",
        { project_id: projectId, cycle_id: cycle.id },
      );
      expect(read.cycle.billing_status).toBe("billed");
      expect(read.cycle.override).not.toBeNull();
    } finally {
      await removeClientFixture(name);
    }
  });

  test("Revenue: back closes Mark all billed, then leaves; the Today line's tap adds no entry", async ({
    page,
  }, info) => {
    const name = nameOf(info, "installed month");
    const clientId = await workClient(name);
    const month = ownMonth(info);
    try {
      const film = await makeProject(clientId, "Daily back film", {
        recurrence: "one_time",
        items: ["Film"],
        delivery: `${month.slice(0, 8)}20`,
      });
      await setAmount(film, 10000);
      await runInstalled(page);
      await page.goto("/today");
      await hydrated(page);
      await page.locator('[data-slot="today-revenue-toggle"]').click();
      await expect(page.locator('[data-slot="today-revenue-figures"]')).toBeVisible();
      const there = `/reports/revenue?month=${month.slice(0, 7)}`;
      await page.goto(there);
      await hydrated(page);
      await page.locator('[data-slot="revenue-mark-all-billed"]').click();
      const confirm = page.getByRole("dialog", { name: /^Mark (all \d+|1) billed$/ });
      await expect(confirm).toBeVisible();
      await expectBackStack(page, [
        { closes: confirm, url: new RegExp(`month=${month.slice(0, 7)}$`) },
        { url: /\/today$/ },
      ]);
      const [cycle] = await serviceSelect<{ id: string }>(
        `project_cycles?project_id=eq.${film}&select=id`,
      );
      const [mark] = await serviceSelect<{ billing_status: string }>(
        `cycle_billing?cycle_id=eq.${cycle?.id}&select=billing_status`,
      );
      expect(mark?.billing_status ?? "not_billed", "backing out marked nothing").toBe("not_billed");
    } finally {
      await removeClientFixture(name);
    }
  });
});

test.describe("an Admin and v2.5", () => {
  test.use({ storageState: storageStateFor("admin") });

  test("the project page, the Revenue address, Today and Alerts hold no amount and send no money read", async ({
    page,
  }, info) => {
    const name = nameOf(info, "admin");
    const clientId = await workClient(name);
    try {
      const projectId = await makeProject(clientId, "Daily sealed", { items: ["Reel 1"] });
      await setAmount(projectId, 4321987);
      const cycle = await cycleOf(projectId);
      await rpcAs(owner.email, owner.password, "billing_mark", {
        cycle_ids: [cycle.id],
        billed: true,
        billed_on: today,
        note: "Sealed invoice",
      });
      await rpcAs(owner.email, owner.password, "revenue_override_set", {
        scope: "cycle",
        ref_id: cycle.id,
        adjusted_value: 1234567,
        note: "Sealed note",
      });
      // The Admin adds a deliverable to the priced month: the Owner is told, never the Admin.
      await rpcAs(admin.email, admin.password, "item_add", {
        cycle_id: cycle.id,
        title: "Sealed extra",
      });
      // Not vacuous: the Owner's reads hold these; every one of them refuses the Admin.
      const history = await rpcAs<unknown[]>(
        owner.email,
        owner.password,
        "project_billing_history",
        {
          project_id: projectId,
        },
      );
      expect(history.length).toBeGreaterThan(0);
      for (const [fn, args] of [
        ["project_billing_history", { project_id: projectId }],
        ["revenue_month_totals", {}],
        ["billing_mark", { cycle_ids: [cycle.id], billed: false, billed_on: null, note: null }],
        ["revenue_override_clear", { scope: "cycle", ref_id: cycle.id, note: "No" }],
      ] as const) {
        const refused = await rpcRefusedAs(admin.email, admin.password, fn, args);
        expect(refused.message, `${fn} refuses the Admin`).toBe("FORBIDDEN");
      }
      const adminId = await memberIdOf(admin.email);
      const told = await serviceSelect<{ id: string }>(
        `notifications?recipient_id=eq.${adminId}&kind=eq.deliverable_not_priced&select=id`,
      );
      expect(told, "the Admin is never told of a price").toEqual([]);

      const session = await ownSession(page, admin.email, admin.password);
      const watch = await watchReads(session);
      const browser: string[] = [];
      page.on("request", (request) => browser.push(request.url()));
      try {
        const path = `/clients/${clientId}/projects/${projectId}`;
        for (const address of [path, "/today", "/notifications"]) {
          await page.goto(address);
          await answerStartPrompt(page);
          await hydrated(page);
          await expectSettled(page);
          const drawn = await page.content();
          for (const secret of [
            "4321987",
            "43,21,987",
            "1234567",
            "12,34,567",
            "Sealed invoice",
            "Sealed note",
          ]) {
            expect(drawn.includes(secret), `${address} holds no ${secret}`).toBe(false);
          }
          await expect(page.locator("main")).not.toContainText("₹");
          await expect(
            page.locator(
              '[data-slot="today-revenue"], [data-slot="today-revenue-skeleton"], [data-slot^="billing-"]',
            ),
          ).toHaveCount(0);
          expect(
            /Not billed|Billed on|Billing history|System calculated|Owner adjusted|Planned deliverables|Open Revenue|isn't priced/.test(
              drawn,
            ),
            `${address}: no v2.5 billing words`,
          ).toBe(false);
        }
        const asked = [...browser];
        await page.goto("/reports/revenue");
        await expect(page).toHaveURL(/\/forbidden/);
        const answer = await page.request.get("/api/revenue/billing-history", {
          params: { project: projectId, limit: "20", oneTime: "0" },
        });
        expect(answer.status(), "the history's address refuses the Admin").toBe(403);
        expect(await answer.text()).not.toContain("₹");

        const reads = watch.server();
        expect(reads, "the watch is live").toContain("/rest/v1/rpc/project_page");
        expect(
          reads.filter((read) => /billing|revenue|advance|item_value|override/.test(read)),
          "no money read on the Admin's requests",
        ).toEqual([]);
        expect(
          asked.filter((url) => /billing|revenue/.test(new URL(url).pathname)),
          "the Admin's screens never ask for revenue",
        ).toEqual([]);
      } finally {
        watch.stop();
      }
    } finally {
      await removeClientFixture(name);
    }
  });
});
