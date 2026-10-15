import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { hydrated, runInstalled, storageStateFor } from "./helpers";

/**
 * "How MaxOff works" (ROADMAP 6b.14): the in-app guide, for the reader's role only. Each role
 * sees its own sections (Crew never a word of client work, approvals or settings, invariant 4);
 * search and the open topics are view controls that never touch the address or history
 * (ARCHITECTURE §14.2 d); the guide is a drill-down of Me (and of Settings for the Owner and
 * Admins), so one back press, or one tap on the header's back control, leaves it. Installed at
 * 375 and 430 (`mobile`, `mobile-lg`), a browser at 1280.
 */

const guide = (page: Page) => page.locator('[data-slot="guide"]');
const sectionIds = (page: Page) =>
  page
    .locator('[data-slot="guide-section"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-section") ?? ""));
const backControl = (page: Page) => page.locator('[data-slot="page-back"]:visible');

async function openGuide(page: Page, hash = ""): Promise<void> {
  await page.goto(`/me/guide${hash}`);
  await hydrated(page);
  await expect(guide(page)).toBeVisible();
}

const ROLES = [
  { role: "owner", label: "Owner", has: ["clients", "help"], never: [] as string[] },
  { role: "admin", label: "Admin", has: ["clients", "help"], never: [] as string[] },
  {
    role: "staff",
    label: "Crew",
    has: ["my-day", "tasks", "help"],
    never: ["clients"],
  },
] as const;

for (const { role, label, has, never } of ROLES) {
  test.describe(`the ${label} guide`, () => {
    test.use({ storageState: storageStateFor(role) });

    test("shows only this role's guide", async ({ page }) => {
      await openGuide(page);
      await expect(guide(page)).toHaveAttribute("data-role", role);
      await expect(page.locator('[data-slot="guide-role"]')).toHaveText(`Written for: ${label}`);
      const ids = await sectionIds(page);
      for (const id of has) expect(ids, `${label} has ${id}`).toContain(id);
      for (const id of never) expect(ids, `${label} never has ${id}`).not.toContain(id);
      expect(ids.at(-1)).toBe("help");
      if (role === "staff") {
        // Everything the page holds, opened or not: the payload carries no client work.
        const text = (await guide(page).textContent()) ?? "";
        expect(text).not.toMatch(/deliverable|project|client|template|preset|approvals/i);
      }
    });
  });
}

test.describe("searching and opening topics", () => {
  test.use({ storageState: storageStateFor("staff") });

  test("search narrows the topics, says when nothing matches, and never changes the address", async ({
    page,
  }) => {
    await openGuide(page);
    const url = page.url();
    const topics = page.locator('[data-slot="guide-topic"]');
    const all = await topics.count();
    expect(all).toBeGreaterThan(5);

    const search = page.locator('[data-slot="guide-search"]');
    await search.fill("reload");
    await expect.poll(() => topics.count()).toBeLessThan(all);
    await expect(page.locator('[data-topic="help-reload"]')).toBeVisible();
    // A few matches open by themselves, so the answer is on the screen.
    await expect(page.locator('[data-topic="help-reload"]')).toHaveAttribute("data-open", "");
    await expect(page.locator('[data-slot="guide-count"]')).toContainText("match");

    await search.fill("zzqx nothing like this");
    await expect(topics).toHaveCount(0);
    await expect(page.locator('[data-slot="empty-state"]')).toContainText("Nothing matches");

    await search.fill("");
    await expect(topics).toHaveCount(all);
    expect(page.url()).toBe(url);
  });

  test("a topic opens and closes in place, and a #topic link opens it on arrival", async ({
    page,
  }) => {
    await openGuide(page, "#help-install");
    const install = page.locator('[data-topic="help-install"]');
    await expect(install).toHaveAttribute("data-open", "");
    await expect(install.locator('[data-slot="guide-topic-body"]')).toBeInViewport();

    const first = page.locator('[data-slot="guide-topic"]').first();
    const toggle = first.locator('[data-slot="guide-topic-toggle"]');
    const url = page.url();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(first.locator('[data-slot="guide-topic-body"]')).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(first.locator('[data-slot="guide-topic-body"]')).toHaveCount(0);
    expect(page.url()).toBe(url);
  });
});

test.describe("reaching the guide", () => {
  test.describe("as a Crew member, from Me", () => {
    test.use({ storageState: storageStateFor("staff") });

    test("Me opens the guide and its back control returns there", async ({ page }) => {
      await page.goto("/me");
      await hydrated(page);
      await page.locator('[data-slot="me-guide-link"]').click();
      await expect(page).toHaveURL(/\/me\/guide$/);
      await expect(guide(page)).toBeVisible();
      await expect(backControl(page)).toHaveAttribute("href", "/me");
      await backControl(page).click();
      await expect(page).toHaveURL(/\/me$/);
    });
  });

  test.describe("as an Admin, from Settings", () => {
    test.use({ storageState: storageStateFor("admin") });

    test("Settings → Help and troubleshooting opens the guide and back returns to Settings", async ({
      page,
    }) => {
      await page.goto("/settings");
      await hydrated(page);
      await page.locator('[data-slot="settings-guide-link"]').click();
      await expect(page).toHaveURL(/\/me\/guide$/);
      await expect(guide(page)).toHaveAttribute("data-role", "admin");
      await expect(backControl(page)).toContainText("Settings");
      await backControl(page).click();
      await expect(page).toHaveURL(/\/settings$/);
    });
  });
});

test.describe("installed: the back gesture leaves the guide in one press", () => {
  test.skip(({ isMobile }) => !isMobile, "the installed app is a phone");

  test.describe("Crew, from Me", () => {
    test.use({ storageState: storageStateFor("staff") });

    test("search and open topics add no history", async ({ page }) => {
      await runInstalled(page);
      await page.goto("/me");
      await hydrated(page);
      await page.locator('[data-slot="me-guide-link"]').click();
      await expect(page).toHaveURL(/\/me\/guide$/);
      await hydrated(page);

      await page.locator('[data-slot="guide-topic-toggle"]').first().click();
      await page.locator('[data-slot="guide-search"]').fill("leave");
      await page.locator('[data-slot="guide-search"]').fill("");
      await page.locator('[data-slot="guide-topic-toggle"]').nth(1).click();

      await page.goBack();
      await expect(page).toHaveURL(/\/me$/);
      await expect(page.locator('[data-slot="me-guide-link"]')).toBeVisible();
    });
  });

  test.describe("Crew, a step's screenshot", () => {
    test.use({ storageState: storageStateFor("staff") });

    test("loads lazily at its own size, enlarges in a sheet, and back closes the sheet first", async ({
      page,
    }) => {
      await runInstalled(page);
      await page.goto("/me");
      await hydrated(page);
      await page.locator('[data-slot="me-guide-link"]').click();
      await expect(page).toHaveURL(/\/me\/guide$/);
      await hydrated(page);
      const topic = page.locator('[data-topic="start-day"]');
      await topic.locator('[data-slot="guide-topic-toggle"]').click();

      const shot = topic.locator('[data-slot="guide-shot"]').first();
      const image = shot.locator("img");
      await expect(image).toHaveAttribute("loading", "lazy");
      await expect(image).toHaveAttribute("width", /^\d+$/);
      await expect(image).toHaveAttribute("height", /^\d+$/);
      expect((await image.getAttribute("alt"))?.trim()).toBeTruthy();
      // Scaled to the column, never wider than the screen.
      const box = await shot.boundingBox();
      expect(box?.width ?? 0).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);

      await shot.click();
      const viewer = page.locator('[data-slot="guide-shot-viewer"]');
      await expect(viewer).toBeVisible();
      await page.goBack();
      await expect(viewer).toBeHidden();
      await expect(page).toHaveURL(/\/me\/guide$/);
      await page.goBack();
      await expect(page).toHaveURL(/\/me$/);
    });
  });

  test.describe("the Owner, from Settings", () => {
    test.use({ storageState: storageStateFor("owner") });

    test("back returns to Settings, by gesture and by the header's control", async ({ page }) => {
      await runInstalled(page);
      await page.goto("/settings");
      await hydrated(page);
      await page.locator('[data-slot="settings-guide-link"]').click();
      await expect(page).toHaveURL(/\/me\/guide$/);
      await hydrated(page);
      await page.locator('[data-slot="guide-topic-toggle"]').first().click();
      await page.goBack();
      await expect(page).toHaveURL(/\/settings$/);

      await page.locator('[data-slot="settings-guide-link"]').click();
      await expect(page).toHaveURL(/\/me\/guide$/);
      await hydrated(page);
      await backControl(page).click();
      await expect(page).toHaveURL(/\/settings$/);
    });
  });
});
