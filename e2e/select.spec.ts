import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";

import { hydrated, storageStateFor } from "./helpers";

/**
 * The select (owner decision 2026-09-27, 3B review, ARCHITECTURE §14.1): below 768px it opens a
 * nested bottom sheet titled with the field's label (48px rows, a ✓ on the current value, a tap
 * picks and closes, swipe-down closes without a change), over a dialog as its own layer; from
 * 768px up it is a popper below the trigger at the trigger's width. The installed back order
 * (sheet, then dialog) is in `back-gesture.spec.ts`. Opens the leave form without sending it.
 */
test.use({ storageState: storageStateFor("staff") });

async function openLeaveForm(page: Page) {
  await page.goto("/leave");
  await hydrated(page);
  await page.getByRole("button", { name: "Request leave" }).click();
  const dialog = page.getByRole("dialog", { name: "Request leave" });
  await expect(dialog).toBeVisible();
  return { dialog, trigger: dialog.getByRole("combobox", { name: "Kind of leave" }) };
}

test.describe("on a phone: a nested bottom sheet", () => {
  test.skip(({ isMobile }) => !isMobile, "the sheet is the phone layout");

  test("titled by the label, 48px rows, ✓ on the value; a tap picks and closes", async ({
    page,
  }) => {
    const { dialog, trigger } = await openLeaveForm(page);
    const before = (await trigger.textContent())?.trim() ?? "";
    await trigger.click();

    const sheet = page.locator('[data-slot="select-sheet"]');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("heading", { name: "Kind of leave" })).toBeVisible();
    // Docked to the bottom edge of the screen, once it has slid in.
    await expect
      .poll(async () => {
        const box = (await sheet.boundingBox())!;
        return Math.round(box.y + box.height);
      })
      .toBe(page.viewportSize()!.height);

    const options = sheet.getByRole("option");
    expect(await options.count()).toBeGreaterThanOrEqual(2);
    for (const option of await options.all()) {
      expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    }
    const current = sheet.getByRole("option", { name: before, exact: true });
    await expect(current).toHaveAttribute("aria-selected", "true");
    await expect(current.locator('[data-slot="select-sheet-check"]')).toBeVisible();

    await sheet.getByRole("option", { name: "Half day", exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(trigger).toHaveText("Half day");
    // The dialog under it stays, with the field the choice brings.
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Date")).toBeVisible();
  });

  test("swipe-down closes the sheet and changes nothing", async ({ page }) => {
    const { dialog, trigger } = await openLeaveForm(page);
    const before = (await trigger.textContent())?.trim() ?? "";
    await trigger.click();
    const sheet = page.locator('[data-slot="select-sheet"]');
    const title = sheet.getByRole("heading", { name: "Kind of leave" });
    await expect(title).toBeVisible();

    // A short slow pull springs back.
    const start = (await title.boundingBox())!;
    const x = start.x + start.width / 2;
    const y = start.y + start.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 30, { steps: 6 });
    await page.waitForTimeout(400);
    await page.mouse.up();
    await expect(sheet).toBeVisible();

    // A long pull closes it.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 160, { steps: 8 });
    await page.mouse.up();
    await expect(sheet).toBeHidden();
    await expect(trigger).toHaveText(before);
    await expect(dialog).toBeVisible();
  });
  test("fits the phone at 130% and 200% system text", async ({ page }) => {
    const { trigger } = await openLeaveForm(page);
    const sheet = page.locator('[data-slot="select-sheet"]');
    for (const scale of [130, 200]) {
      await page.evaluate((percent) => {
        document.documentElement.style.fontSize = `${percent}%`;
      }, scale);
      await trigger.click();
      await expect(sheet.getByRole("heading", { name: "Kind of leave" })).toBeVisible();
      const wide = await sheet.evaluate((element) =>
        [...element.querySelectorAll<HTMLElement>("*")]
          .filter(
            (el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1,
          )
          .map((el) => el.tagName.toLowerCase()),
      );
      expect(wide, `nothing in the sheet reaches past the edge at ${scale}%`).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
    }
  });
});

test.describe("from 768px: a popper below the trigger", () => {
  test.skip(({ isMobile }) => isMobile, "the popper is the desktop layout");

  test("at the trigger's width, under it, and never a sheet", async ({ page }) => {
    const { trigger } = await openLeaveForm(page);
    await trigger.click();
    const list = page.getByRole("listbox");
    await expect(list).toBeVisible();
    await expect(page.locator('[data-slot="select-sheet"]')).toHaveCount(0);

    const content = page.locator('[data-slot="select-content"]');
    // An open list hides the dialog from the accessibility tree, so the trigger is found by its
    // slot; both boxes are read once the dialog's and the list's opening zoom has settled.
    const box = page.locator('[role="dialog"] [data-slot="select-trigger"]');
    await expect
      .poll(async () => {
        const at = (await box.boundingBox())!;
        const list = (await content.boundingBox())!;
        return {
          below: list.y >= at.y + at.height,
          sameWidth: Math.abs(list.width - at.width) <= 1,
          sameLeft: Math.abs(list.x - at.x) <= 1,
        };
      })
      .toEqual({ below: true, sameWidth: true, sameLeft: true });

    await page.getByRole("option", { name: "Half day", exact: true }).click();
    await expect(list).toBeHidden();
    await expect(trigger).toHaveText("Half day");
  });
});
