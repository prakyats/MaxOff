import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";

import {
  hydrated,
  memberIdOf,
  pageHeader,
  removeClientFixture,
  serviceInsert,
  serviceSelect,
  storageStateFor,
  USERS,
} from "./helpers";

/**
 * Phase 3 review (owner's phone walk, Samsung S23): in edit mode the sticky Save/Cancel bar covered
 * the last fields ("Job title" on a person's Profile sat behind it and could not be scrolled
 * above it). While the bar is shown the page reserves its real height (plus the bottom bar and
 * the safe area), so after scrolling to the end the last field's bottom is above the bar's top,
 * at every text size; and a focused field scrolls into view above the bar.
 */
test.describe("the sticky save bar never covers the last field (§14.1)", () => {
  test.use({ storageState: storageStateFor("owner") });
  test.skip(({ isMobile }) => !isMobile, "the bar is fixed only below 768px");

  const record = (page: Page, title: string) =>
    page.locator('[data-slot="editable-record"]', {
      has: page.getByRole("heading", { name: title, exact: true }),
    });

  /** The last form control of the record, and the bar, after scrolling to the very end. */
  async function lastFieldClearsTheBar(page: Page, title: string, label: string) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const bar = page.locator('[data-slot="sticky-actions"]');
    await expect(bar).toBeVisible();
    const fields = record(page, title).locator(
      "input:not([type=hidden]), textarea, button[role=combobox]",
    );
    const last = fields.last();
    await expect(async () => {
      const [field, barBox] = await Promise.all([last.boundingBox(), bar.boundingBox()]);
      expect(field, "the last field is laid out").not.toBeNull();
      expect(barBox, "the bar is laid out").not.toBeNull();
      expect(
        field!.y + field!.height,
        `${label}: the last field ends above the bar`,
      ).toBeLessThanOrEqual(barBox!.y);
    }).toPass();
  }

  async function check(page: Page, path: string, title: string) {
    await page.goto(path);
    await expect(pageHeader(page)).toBeVisible();
    await hydrated(page);
    await record(page, title).locator('[data-slot="edit-record"]').click();
    await expect(page.locator('[data-slot="sticky-actions"]')).toBeVisible();
    for (const scale of [100, 130, 200]) {
      await page.evaluate((percent) => {
        document.documentElement.style.fontSize = `${percent}%`;
      }, scale);
      await lastFieldClearsTheBar(page, title, `${path} at ${scale}%`);
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });

    // A focused field is scrolled into view above the bar (scroll-margin), not behind it.
    await page.evaluate(() => window.scrollTo(0, 0));
    const last = record(page, title)
      .locator("input:not([type=hidden]), textarea, button[role=combobox]")
      .last();
    await last.focus();
    await expect(async () => {
      const [field, bar] = await Promise.all([
        last.boundingBox(),
        page.locator('[data-slot="sticky-actions"]').boundingBox(),
      ]);
      expect(field!.y + field!.height).toBeLessThanOrEqual(bar!.y);
    }).toPass();
  }

  test("on /me", async ({ page }) => {
    await check(page, "/me", "Profile");
  });

  test("on a person's Profile", async ({ page }, info) => {
    const id = await memberIdOf(`profile-${info.project.name}@maxoff.local`);
    await check(page, `/people/${id}`, "Profile");
  });

  test("on a client's Details", async ({ page }, info) => {
    const name = `Test Client Sticky (${info.project.name})`;
    await removeClientFixture(name);
    const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
    const client = await serviceInsert<{ id: string }>("clients", {
      org_id: org?.id,
      name,
      admin_id: await memberIdOf(USERS.admin.email),
    });
    await check(page, `/clients/${client.id}`, "Details");
  });
});
