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

  /**
   * v1.3.1 (CI 36879970598, "Job title" 20 px behind the bar at 200%, once): the bar and the
   * bands publish their measured heights, so a reserve can grow while a person rests at the
   * page's end. The padding grew with it but the page kept its scroll position, so the bar
   * moved up over the last field until the person scrolled again. Now a person at the end stays
   * at the end, in the same frame (`changeBottomReserve`).
   */
  test.describe("a reserve that grows at the page's end keeps the last field clear", () => {
    const lastField = (page: Page) =>
      record(page, "Profile")
        .locator("input:not([type=hidden]), textarea, button[role=combobox]")
        .last();
    const bar = (page: Page) => page.locator('[data-slot="sticky-actions"]');
    /** Two painted frames: whatever the reserves publish has been laid out. */
    const frames = (page: Page) =>
      page.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          ),
      );
    /** The last field's bottom minus the bar's top, read in the page (> 0: covered). */
    const overlap = (page: Page) =>
      Promise.all([lastField(page).boundingBox(), bar(page).boundingBox()]).then(
        ([field, barBox]) => field!.y + field!.height - barBox!.y,
      );
    async function editProfile(page: Page, project: string) {
      const id = await memberIdOf(`profile-${project}@maxoff.local`);
      await page.goto(`/people/${id}`);
      await expect(pageHeader(page)).toBeVisible();
      await hydrated(page);
      await record(page, "Profile").locator('[data-slot="edit-record"]').click();
      await expect(bar(page)).toBeVisible();
    }
    /** A person's scroll to the very end (wheel input, over real frames). */
    async function scrollToEnd(page: Page) {
      const atEnd = () =>
        page.evaluate(
          () => document.documentElement.scrollHeight - window.innerHeight - window.scrollY <= 1,
        );
      for (let turn = 0; turn < 12 && !(await atEnd()); turn++) {
        await page.mouse.move(8, 300);
        await page.mouse.wheel(0, 400);
        await frames(page);
      }
      expect(await atEnd(), "the page is at its end").toBe(true);
    }

    test("the connection drops: the offline band appears under a person at the end", async ({
      page,
      context,
    }, info) => {
      await editProfile(page, info.project.name);
      for (const scale of ["100%", "200%"]) {
        await page.evaluate((size) => {
          document.documentElement.style.fontSize = size;
        }, scale);
        await frames(page);
        await scrollToEnd(page);
        expect(await overlap(page), `${scale}: clear at the end`).toBeLessThanOrEqual(0);
        await context.setOffline(true);
        await expect(page.locator('[data-slot="offline-banner"]')).toBeVisible();
        await frames(page);
        // Measured once, never scrolled again: what the person sees without touching the page.
        expect(await overlap(page), `${scale}: offline, still clear`).toBeLessThanOrEqual(0);
        await context.setOffline(false);
        await expect(page.locator('[data-slot="offline-banner"]')).toHaveCount(0);
      }
    });

    test("the text grows in the frame the page is scrolled to its end", async ({ page }, info) => {
      await editProfile(page, info.project.name);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "130%";
      });
      await frames(page);
      await scrollToEnd(page);
      // The CI run's order, made certain: 200% and the scroll in one task, so the scroll's end is
      // computed before the bar and the band have measured themselves at 200%.
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
        window.scrollTo(0, document.documentElement.scrollHeight);
      });
      await frames(page);
      expect(await overlap(page), "200%: clear without another scroll").toBeLessThanOrEqual(0);
    });
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
