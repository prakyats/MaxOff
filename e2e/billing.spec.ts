import type { Locator, Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  animationsSettled,
  answerStartPrompt,
  expectNoHorizontalScroll,
  expectSettled,
  holdReads,
  hydrated,
  memberIdOf,
  ownSession,
  removeClientFixture,
  rpcAs,
  rpcRefusedAs,
  serviceInsert,
  serviceSelect,
  storageStateFor,
  USERS,
  watchReads,
} from "./helpers";
import { addISTDays, formatIST, istDayStart, todayIST } from "../src/core/time";

/**
 * A project's Billing section (v2.1 "Money in", unit 9.2; DATA-MODEL §7, WORKFLOWS §6): the
 * Owner sets a retainer's first amount and sees Potential, changes the category, prices a
 * deliverable the client's Admin added; on a one-time project sets the amount, records an advance
 * and marks it returned; each sheet says what is wrong with an amount in words. **The client's
 * Admin has no Billing section, no request for it, and no amount anywhere in the page** (invariant
 * 2). And the section streams in behind a skeleton that traces it, moving nothing above.
 *
 * Every client is named for its test and project and removed first (`removeClientFixture`, which
 * removes its billing rows too), so the spec re-runs on a used database and never reads another
 * spec's rows.
 */

const owner = USERS.owner;
const admin = USERS.admin;
const nameOf = (info: TestInfo, what: string) => `Billing ${what} (${info.project.name})`;

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

/** A project made by the client's Admin through `project_create`. */
async function makeProject(
  clientId: string,
  name: string,
  options: { recurrence?: string; items: string[]; delivery?: string },
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

/** The project's current cycle (a new project has one). */
async function cycleOf(projectId: string): Promise<{ id: string; label: string }> {
  const [cycle] = await serviceSelect<{ id: string; label: string }>(
    `project_cycles?project_id=eq.${projectId}&select=id,label&order=period_start.desc&limit=1`,
  );
  expect(cycle, "the project's cycle").toBeTruthy();
  return cycle!;
}

const section = (page: Page) => page.locator('[data-slot="project-billing"]');
const valueOf = (row: Locator) => row.locator('[data-slot="billing-value"]');
const figure = (page: Page, name: "potential" | "achieved" | "remaining") =>
  section(page).locator(`[data-slot="billing-${name}"] dd`);
const sheet = (page: Page, title: string) => page.getByRole("dialog", { name: title });
const fieldError = (dialog: Locator) => dialog.locator('[data-slot="field-error"]');

test.describe("the Owner's Billing section", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("a retainer: the first amount and Potential, the category, an added deliverable priced", async ({
    page,
  }, info) => {
    const clientId = await workClient(nameOf(info, "retainer"));
    const projectId = await makeProject(clientId, "Billing reels", { items: ["Reel 1", "Reel 2"] });
    const cycle = await cycleOf(projectId);
    const path = `/clients/${clientId}/projects/${projectId}`;
    await page.goto(path);
    await hydrated(page);
    await expectSettled(page);

    const billing = section(page);
    const category = billing.locator('[data-slot="billing-category"]');
    const amount = billing.locator('[data-slot="billing-amount"]');
    await expect(billing.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
    // The default category follows the repeat; nothing is priced yet.
    await expect(valueOf(category)).toHaveText("Retainer");
    await expect(amount).toContainText("Amount per month");
    await expect(valueOf(amount)).toHaveText("No amount set");
    await expect(billing.locator('[data-slot="billing-cycle"]')).toContainText(cycle.label);
    await expect(figure(page, "potential")).toHaveText("₹0");
    await expect(billing.locator('[data-slot="billing-added"]')).toHaveCount(0);

    // The first amount: the sheet says which months it covers, and refuses what is not whole rupees.
    await amount.getByRole("button", { name: "Set amount" }).click();
    const setAmount = sheet(page, "Set the amount");
    const month = formatIST(istDayStart(todayIST()), "MMMM yyyy");
    await expect(setAmount).toContainText(`From ${month} on. Earlier months stay "No amount set".`);
    const field = setAmount.getByLabel("Amount per month (₹)");
    await setAmount.getByRole("button", { name: "Save amount" }).click();
    await expect(fieldError(setAmount)).toHaveText("Enter the amount in rupees.");
    await field.fill("40000.50");
    await expect(fieldError(setAmount), "typing again clears the message").toHaveCount(0);
    await setAmount.getByRole("button", { name: "Save amount" }).click();
    await expect(fieldError(setAmount)).toHaveText("Whole rupees only, no paise.");
    await field.fill("-500");
    await setAmount.getByRole("button", { name: "Save amount" }).click();
    await expect(fieldError(setAmount)).toHaveText("The amount can't be less than ₹0.");
    await expect(field, "the field is marked invalid").toHaveAttribute("aria-invalid", "true");
    if ((page.viewportSize()?.width ?? 1280) < 768) {
      // A phone: a bottom sheet, a 16 px field (no zoom on focus), 44 px buttons.
      // Measured once the sheet has finished sliding up.
      await animationsSettled(page);
      await expect(field).toHaveCSS("font-size", "16px");
      const save = await setAmount.getByRole("button", { name: "Save amount" }).boundingBox();
      expect(save?.height ?? 0, "a 44 px commit").toBeGreaterThanOrEqual(44);
      await expectNoHorizontalScroll(page);
    }
    await field.fill("40,000");
    await setAmount.getByRole("button", { name: "Save amount" }).click();
    await expect(setAmount).toBeHidden();
    await expect(valueOf(amount)).toHaveText("₹40,000");
    await expect(figure(page, "potential")).toHaveText("₹40,000");
    await expect(figure(page, "achieved")).toHaveText("₹0");
    await expect(figure(page, "remaining")).toHaveText("₹40,000");

    // A later change says so; Cancel leaves the amount as it was.
    await amount.getByRole("button", { name: "Change the amount" }).click();
    const change = sheet(page, "Change the amount");
    await expect(change).toContainText(
      "Applies from this month on. Earlier ones keep their amount.",
    );
    await expect(change.getByLabel("Amount per month (₹)")).toHaveValue("40000");
    await change.getByRole("button", { name: "Cancel" }).click();
    await expect(change).toBeHidden();
    await expect(valueOf(amount)).toHaveText("₹40,000");

    // The category.
    await category.getByRole("button", { name: "Change the category" }).click();
    const categories = sheet(page, "Change the category");
    await expect(categories.getByRole("radio", { name: /^Retainer/ })).toBeChecked();
    await categories.getByRole("radio", { name: /^Additional Work/ }).check();
    await categories.getByRole("button", { name: "Save category" }).click();
    await expect(categories).toBeHidden();
    await expect(valueOf(category)).toHaveText("Additional Work");

    // The client's Admin adds a deliverable: the Owner sees it "Not priced", outside the amount.
    await rpcAs(admin.email, admin.password, "item_add", {
      cycle_id: cycle.id,
      title: "Extra poster",
    });
    await page.reload();
    await hydrated(page);
    const added = billing.locator('[data-slot="billing-added"]');
    await expect(added).toContainText("Added this month");
    const row = added.locator('[data-slot="billing-added-row"]', { hasText: "Extra poster" });
    await expect(row.locator('[data-slot="billing-price"]')).toHaveText("Not priced");
    await expect(figure(page, "potential")).toHaveText("₹40,000");
    // The section with its added row fits (measured here: a fresh page, no toast on screen).
    await expectNoHorizontalScroll(page);
    if ((page.viewportSize()?.width ?? 1280) < 768) {
      // Large system text (§14.1): the rows and the three figures still fit the phone.
      for (const scale of [130, 200]) {
        await page.evaluate((percent) => {
          document.documentElement.style.fontSize = `${percent}%`;
        }, scale);
        await expectNoHorizontalScroll(page);
      }
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "";
      });
    }
    await row.getByRole("button", { name: "Set the price of Extra poster" }).click();
    const price = sheet(page, "Set the price");
    await expect(price).toContainText("Extra poster");
    await price.getByLabel("Price (₹)").fill("12.5");
    await price.getByRole("button", { name: "Save price" }).click();
    await expect(fieldError(price)).toHaveText("Whole rupees only, no paise.");
    await price.getByLabel("Price (₹)").fill("5000");
    await price.getByRole("button", { name: "Save price" }).click();
    await expect(price).toBeHidden();
    await expect(row.locator('[data-slot="billing-price"]')).toHaveText("₹5,000");
    await expect(
      row.getByRole("button", { name: "Change the price of Extra poster" }),
    ).toBeVisible();
    await expect(figure(page, "potential"), "the price comes on top").toHaveText("₹45,000");
    await expect(figure(page, "remaining")).toHaveText("₹45,000");

    await removeClientFixture(nameOf(info, "retainer"));
  });

  test("a one-time project: the amount, an advance recorded and marked returned", async ({
    page,
  }, info) => {
    const today = todayIST();
    const clientId = await workClient(nameOf(info, "one-time"));
    const projectId = await makeProject(clientId, "Billing film", {
      recurrence: "one_time",
      items: ["Film"],
      delivery: addISTDays(today, 10),
    });
    await page.goto(`/clients/${clientId}/projects/${projectId}`);
    await hydrated(page);
    await expectSettled(page);

    const billing = section(page);
    const amount = billing.locator('[data-slot="billing-amount"]');
    const advances = billing.locator('[data-slot="billing-advances"]');
    await expect(valueOf(billing.locator('[data-slot="billing-category"]'))).toHaveText("Project");
    await expect(amount).toContainText("Amount");
    await expect(valueOf(amount)).toHaveText("No amount set");
    // No advance before an amount.
    await expect(advances).toContainText("Set the amount to record an advance.");
    await expect(advances.getByRole("button", { name: "Record advance" })).toHaveCount(0);
    await expect(billing.locator('[data-slot="billing-cycle"]')).toHaveCount(0);

    await amount.getByRole("button", { name: "Set amount" }).click();
    const setAmount = sheet(page, "Set the amount");
    await expect(setAmount).toContainText("One amount for the whole project.");
    await setAmount.getByLabel("Amount (₹)").fill("60000");
    await setAmount.getByRole("button", { name: "Save amount" }).click();
    await expect(setAmount).toBeHidden();
    await expect(valueOf(amount)).toHaveText("₹60,000");
    await expect(advances).toContainText("None received yet.");

    // Record an advance: whole rupees above ₹0, received today by default and never later.
    await advances.getByRole("button", { name: "Record advance" }).click();
    const record = sheet(page, "Record an advance");
    const received = record.getByLabel("Amount received (₹)");
    const date = record.getByLabel("Date received");
    await expect(date).toHaveValue(today);
    await expect(date).toHaveAttribute("max", today);
    await record.getByRole("button", { name: "Record advance" }).click();
    await expect(fieldError(record)).toHaveText("Enter the amount in rupees.");
    await received.fill("0");
    await record.getByRole("button", { name: "Record advance" }).click();
    await expect(fieldError(record)).toHaveText("Enter an amount above ₹0.");
    await received.fill("30000.75");
    await record.getByRole("button", { name: "Record advance" }).click();
    await expect(fieldError(record)).toHaveText("Whole rupees only, no paise.");
    // More than the project's amount: the function refuses, the sheet says why and keeps the form.
    await received.fill("70000");
    await record.getByRole("button", { name: "Record advance" }).click();
    await expect(record.locator('[data-slot="form-alert"]')).toHaveText(
      "Advances can't add up to more than the project's amount.",
    );
    await expect(received).toHaveValue("70000");
    await received.fill("30000");
    await record.getByLabel("Note (optional)").fill("On signing");
    await record.getByRole("button", { name: "Record advance" }).click();
    await expect(record).toBeHidden();

    const row = advances.locator('[data-slot="billing-advance-row"]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("₹30,000");
    await expect(row).toContainText(formatIST(istDayStart(today), "d MMM yyyy"));
    await expect(row).toContainText("On signing");
    await expect(advances.locator('[data-slot="billing-advance-summary"]')).toHaveText(
      "Advance received ₹30,000 · Balance on delivery ₹30,000",
    );

    // Mark it returned: the row stays, marked; nothing is counted as received any more.
    await row.getByRole("button", { name: "Mark the advance of ₹30,000 returned" }).click();
    const returned = sheet(page, "Mark the advance returned");
    await expect(returned).toContainText("₹30,000 received on");
    await expect(returned.getByLabel("Date returned")).toHaveValue(today);
    await returned.getByLabel("Note (optional)").fill("Paid twice");
    await returned.getByRole("button", { name: "Mark returned" }).click();
    await expect(returned).toBeHidden();
    await expect(row).toHaveCount(1);
    await expect(row.locator('[data-slot="billing-advance-returned"]')).toHaveText(
      `Returned on ${formatIST(istDayStart(today), "d MMM")} · Paid twice`,
    );
    await expect(row.getByRole("button")).toHaveCount(0);
    await expect(advances.locator('[data-slot="billing-advance-summary"]')).toHaveCount(0);
    // It is all still there on a fresh page (which has no toast on screen), and it fits.
    await page.reload();
    await hydrated(page);
    await expect(row.locator('[data-slot="billing-advance-returned"]')).toContainText(
      "Returned on",
    );
    await expect(valueOf(amount)).toHaveText("₹60,000");
    await expectNoHorizontalScroll(page);

    await removeClientFixture(nameOf(info, "one-time"));
  });

  test("the section streams in behind a skeleton that traces it; nothing above moves", async ({
    page,
  }, info) => {
    const clientId = await workClient(nameOf(info, "skeleton"));
    const projectId = await makeProject(clientId, "Billing skeleton", { items: ["Reel 1"] });
    await rpcAs(owner.email, owner.password, "billing_set_project", {
      project_id: projectId,
      amount: 40000,
      set_amount: true,
      category: null,
    });
    // A session of this test's own, so only this page's billing read is held.
    const session = await ownSession(page, owner.email, owner.password);
    const held = await holdReads("/rest/v1/rpc/project_billing_read", session);
    const tops = (selectors: Record<string, string>) =>
      page.evaluate((points) => {
        const found: Record<string, number | null> = {};
        for (const [name, selector] of Object.entries(points)) {
          const element = [...document.querySelectorAll<HTMLElement>(selector)].find(
            (candidate) =>
              candidate.getBoundingClientRect().height > 0 && candidate.checkVisibility(),
          );
          found[name] = element ? element.getBoundingClientRect().top + window.scrollY : null;
        }
        return found;
      }, selectors);
    const ABOVE = {
      "the deliverables": '[data-slot="item-row"]',
      details: '[data-slot="project-details-grid"]',
    };
    try {
      await page.goto(`/clients/${clientId}/projects/${projectId}`, { waitUntil: "commit" });
      const skeleton = page.locator('[data-slot="billing-skeleton"]');
      // The page is in (its header, its deliverables, Details) while Billing still waits.
      await expect(skeleton).toBeVisible();
      await expect(page.locator('[data-slot="project-details-grid"]')).toBeVisible();
      await expect.poll(() => held.caught(), { message: "the billing read is held" }).toBe(true);
      await expect(section(page)).toHaveCount(0);
      const before = await tops({
        ...ABOVE,
        heading: '[data-slot="billing-skeleton"] > :first-child',
        card: '[data-slot="billing-skeleton"] > :nth-child(2)',
        "the category row": '[data-slot="billing-skeleton"] [data-row]:nth-child(1)',
        "the amount row": '[data-slot="billing-skeleton"] [data-row]:nth-child(2)',
        "the cycle's figures": '[data-slot="billing-skeleton"] [data-row]:nth-child(3)',
      });
      const skeletonHeight = (await skeleton.boundingBox())?.height ?? 0;
      await expectNoHorizontalScroll(page);

      held.release();
      await expect(skeleton).toHaveCount(0);
      await expect(section(page)).toBeVisible();
      await hydrated(page);
      await expectSettled(page);
      const after = await tops({
        ...ABOVE,
        heading: '[data-slot="project-billing"] > h2',
        card: '[data-slot="project-billing"] > div',
        "the category row": '[data-slot="billing-category"]',
        "the amount row": '[data-slot="billing-amount"]',
        "the cycle's figures": '[data-slot="billing-cycle"]',
      });
      const moved = Object.keys(before).flatMap((name) => {
        const from = before[name];
        const to = after[name];
        if (from === null || from === undefined) return [`${name}: not in the skeleton`];
        if (to === null || to === undefined) return [`${name}: not on the page`];
        return Math.abs(to - from) > 1 ? [`${name}: ${from.toFixed(1)} → ${to.toFixed(1)}`] : [];
      });
      expect(moved, "nothing moves when the billing arrives").toEqual([]);
      // With nothing added, the section is exactly as tall as its skeleton.
      const sectionHeight = (await section(page).boundingBox())?.height ?? 0;
      expect(Math.abs(sectionHeight - skeletonHeight), "the skeleton's height").toBeLessThanOrEqual(
        1,
      );
    } finally {
      held.release();
      await removeClientFixture(nameOf(info, "skeleton"));
    }
  });
});

test.describe("the client's Admin", () => {
  test.use({ storageState: storageStateFor("admin") });

  test("no Billing section, no request for it, and no amount in the page", async ({
    page,
  }, info) => {
    const clientId = await workClient(nameOf(info, "admin"));
    const projectId = await makeProject(clientId, "Billing sealed", { items: ["Reel 1"] });
    const cycle = await cycleOf(projectId);
    // The Owner prices it all: an amount, and an added deliverable with its own price.
    await rpcAs(owner.email, owner.password, "billing_set_project", {
      project_id: projectId,
      amount: 4321987,
      set_amount: true,
      category: "additional_work",
    });
    const added = await rpcAs<string>(admin.email, admin.password, "item_add", {
      cycle_id: cycle.id,
      title: "Sealed extra",
    });
    await rpcAs(owner.email, owner.password, "item_value_set", { item_id: added, value: 678123 });
    // Not vacuous: the Owner's read holds these amounts.
    const read = await rpcAs<{ cycle: { potential: number } }>(
      owner.email,
      owner.password,
      "project_billing_read",
      { project_id: projectId, cycle_id: cycle.id },
    );
    expect(read.cycle.potential).toBe(5000110);
    // And the function itself refuses the client's Admin.
    const refused = await rpcRefusedAs(admin.email, admin.password, "project_billing_read", {
      project_id: projectId,
    });
    expect(refused.message).toBe("FORBIDDEN");

    const path = `/clients/${clientId}/projects/${projectId}`;
    const session = await ownSession(page, admin.email, admin.password);
    const watch = await watchReads(session);
    try {
      await page.goto(path);
      await answerStartPrompt(page);
      await hydrated(page);
      await expectSettled(page);
      // The page is the Admin's own, in full: its deliverables and Details.
      await expect(
        page.locator('[data-slot="item-row"]', { hasText: "Sealed extra" }),
      ).toBeVisible();
      await expect(page.locator('[data-slot="project-details-grid"]')).toBeVisible();
      await expect(section(page)).toHaveCount(0);
      await expect(page.locator('[data-slot="billing-skeleton"]')).toHaveCount(0);
      await expect(page.locator('[data-slot^="billing-"]')).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Billing", exact: true })).toHaveCount(0);

      // The page's HTML (with its inlined payload) and the router's own payload for the same page.
      const html = await (await page.request.get(path)).text();
      const flight = await page.request.get(path, { headers: { RSC: "1" } });
      expect(flight.headers()["content-type"], "the router's payload").toContain(
        "text/x-component",
      );
      for (const [what, body] of [
        ["the HTML", html],
        ["the router's payload", await flight.text()],
        ["the page as drawn", await page.content()],
      ] as const) {
        expect(body, `${what} is the project's page`).toContain("Sealed extra");
        // Long, odd amounts, so no id or timestamp holds one by chance; with and without grouping.
        for (const secret of ["4321987", "678123", "5000110"]) {
          expect(
            new RegExp(`(?<![\\w-])${secret}(?![\\w-])`).test(body),
            `${what} holds no ${secret}`,
          ).toBe(false);
        }
        for (const secret of ["43,21,987", "6,78,123", "50,00,110"]) {
          expect(body.includes(secret), `${what} holds no ${secret}`).toBe(false);
        }
        expect(body.includes("project-billing"), `${what} has no Billing section`).toBe(false);
        expect(
          /No amount set|Not priced|Amount per month/.test(body),
          `${what}: no billing words`,
        ).toBe(false);
      }

      // The server asked the database for the page, never for its billing.
      const reads = watch.server();
      expect(reads, "the page's own read was seen (the watch is live)").toContain(
        "/rest/v1/rpc/project_page",
      );
      expect(
        reads.filter((read) => /billing|revenue|advance|item_value/.test(read)),
        "no billing read on the Admin's requests",
      ).toEqual([]);
    } finally {
      watch.stop();
      await removeClientFixture(nameOf(info, "admin"));
    }
  });
});
