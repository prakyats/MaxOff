import { type Page, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { hydrated, pageHeader, runInstalled, signIn, storageStateFor } from "./helpers";

/**
 * The edit pattern (ARCHITECTURE §14.1, §14.2 f, task 2.9): read-only by default, explicit
 * Edit, Save disabled until something changed, a confirmation that names each change, and
 * "Discard changes?" on every way out — Cancel, the back gesture, an in-app link, Log out.
 *
 * Each project owns its people (`profile-<project>@`, `memberedit-<project>@`, seeded in 2.9) and
 * every test puts the values back, so projects never race and the spec re-runs without a reset.
 * Phones run installed, where back is the system gesture.
 */
const PASSWORD = "profile-local-password";
const profilePerson = (info: TestInfo) => ({
  email: `profile-${info.project.name}@maxoff.local`,
  name: `Test Profile (${info.project.name})`,
});
const memberEditName = (info: TestInfo) => `Test Member Edit (${info.project.name})`;

const record = (page: Page) => page.locator('[data-slot="editable-record"]');
const editButton = (page: Page) => page.getByRole("button", { name: "Edit profile" });
const saveButton = (page: Page) => record(page).getByRole("button", { name: "Save" });
const confirmation = (page: Page) => page.getByRole("alertdialog", { name: "Save these changes?" });
const discardDialog = (page: Page) => page.getByRole("alertdialog", { name: "Discard changes?" });
const phoneValue = (page: Page) =>
  record(page).locator('[data-slot="record-value"]', { hasText: "Phone" }).locator("dd");

async function openMe(page: Page, isMobile: boolean, info: TestInfo) {
  if (isMobile) await runInstalled(page);
  const person = profilePerson(info);
  await signIn(page, person.email, PASSWORD);
  // A real entry beneath /me, so "back leaves /me" is observable.
  await page.goto("/my-day");
  await expect(pageHeader(page)).toBeVisible();
  await page.goto("/me");
  await hydrated(page);
  await expect(editButton(page)).toBeVisible();
}

/** Saves `phone` through the whole pattern: Edit, type, Save, confirm. */
async function savePhone(page: Page, phone: string, line: string) {
  await editButton(page).click();
  await page.getByLabel("Phone").fill(phone);
  await saveButton(page).click();
  await expect(confirmation(page)).toContainText(line);
  await confirmation(page).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Profile saved")).toBeVisible();
  await expect(editButton(page)).toBeVisible();
}

test.describe("/me: the profile is read-only first and edited deliberately", () => {
  test("Save waits for a real change, and the confirmation names it", async ({
    page,
    isMobile,
  }, info) => {
    await openMe(page, isMobile, info);
    // Read-only first: values, no inputs.
    await expect(record(page).getByRole("textbox")).toHaveCount(0);
    await expect(record(page)).toContainText(profilePerson(info).name);
    await expect(phoneValue(page)).toHaveText("Not added");

    await editButton(page).click();
    await expect(saveButton(page)).toBeDisabled();
    await page.getByLabel("Phone").fill("98450 12345");
    await expect(saveButton(page)).toBeEnabled();
    // Typing it back is no change.
    await page.getByLabel("Phone").fill("");
    await expect(saveButton(page)).toBeDisabled();
    // Keep editing from the confirmation returns to the fields, as typed.
    await page.getByLabel("Phone").fill("98450 12345");
    await saveButton(page).click();
    await expect(confirmation(page)).toContainText("Your phone number will be set to 98450 12345.");
    await confirmation(page).getByRole("button", { name: "Keep editing" }).click();
    await expect(page.getByLabel("Phone")).toHaveValue("98450 12345");

    await saveButton(page).click();
    await confirmation(page).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Profile saved")).toBeVisible();
    await expect(phoneValue(page)).toHaveText("98450 12345");
    await page.reload();
    await expect(phoneValue(page)).toHaveText("98450 12345");

    // Put it back: a removal is named as one.
    await savePhone(page, "", "Your phone number will be removed.");
    await expect(phoneValue(page)).toHaveText("Not added");
  });

  test("back: nothing changed leaves edit mode; changes ask first; no spare entries", async ({
    page,
    isMobile,
  }, info) => {
    await openMe(page, isMobile, info);
    const name = profilePerson(info).name;

    // Nothing changed: one back leaves edit mode, the page stays.
    await editButton(page).click();
    await page.goBack();
    await expect(editButton(page)).toBeVisible();
    await expect(page).toHaveURL(/\/me$/);

    // Changes: back asks; back again keeps editing; Discard puts the old value back.
    await editButton(page).click();
    await page.getByLabel("Full name").fill(`${name} typo`);
    await page.goBack();
    await expect(discardDialog(page)).toBeVisible();
    await expect(page).toHaveURL(/\/me$/);
    await page.goBack();
    await expect(discardDialog(page)).toBeHidden();
    await expect(page.getByLabel("Full name")).toHaveValue(`${name} typo`);
    await page.goBack();
    await discardDialog(page).getByRole("button", { name: "Discard changes" }).click();
    await expect(editButton(page)).toBeVisible();
    await expect(record(page)).toContainText(name);

    // Cancel with nothing changed goes straight back to read mode.
    await editButton(page).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(editButton(page)).toBeVisible();

    // Every way out backed its entry out: one back leaves /me for the page beneath.
    await page.goBack();
    await expect(page).toHaveURL(/\/my-day$/);
  });

  test("a link while editing asks first, and Discard follows it", async ({
    page,
    isMobile,
  }, info) => {
    await openMe(page, isMobile, info);
    await editButton(page).click();
    await page.getByLabel("Full name").fill("Someone Else");

    const myDay = page.getByRole("link", { name: "My Day" }).filter({ visible: true }).first();
    await myDay.click();
    await expect(discardDialog(page)).toBeVisible();
    await discardDialog(page).getByRole("button", { name: "Keep editing" }).click();
    await expect(page).toHaveURL(/\/me$/);
    await expect(page.getByLabel("Full name")).toHaveValue("Someone Else");

    await myDay.click();
    await discardDialog(page).getByRole("button", { name: "Discard changes" }).click();
    await expect(page).toHaveURL(/\/my-day$/);
    // Nothing was saved.
    await page.goto("/me");
    await expect(record(page)).toContainText(profilePerson(info).name);
  });

  test("Log out while editing warns that the changes will be lost", async ({
    page,
    isMobile,
  }, info) => {
    await openMe(page, isMobile, info);
    await editButton(page).click();
    await page.getByLabel("Full name").fill("Someone Else");
    await page.getByRole("button", { name: "Log out" }).click();
    const logout = page.getByRole("alertdialog", { name: "Log out?" });
    await expect(logout.locator('[data-slot="logout-unsaved"]')).toHaveText(
      "Your unsaved changes will be lost.",
    );
    await logout.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByLabel("Full name")).toHaveValue("Someone Else");
  });
});

test.describe("People: the Owner's edit of a member names the change", () => {
  test.use({ storageState: storageStateFor("owner") });

  async function openEdit(page: Page, isMobile: boolean, name: string) {
    await page.goto("/people");
    await hydrated(page);
    if (isMobile) {
      // Cards come ten at a time; the seeded people sit further down.
      const more = page.getByRole("button", { name: `More for ${name}` });
      while (!(await more.isVisible())) {
        await page.locator('[data-slot="data-cards-more"]').click();
      }
      await more.click();
      await page
        .locator('[data-slot="detail-sheet"]')
        .getByRole("button", { name: "Edit" })
        .click();
    } else {
      await page.getByRole("button", { name: `Actions for ${name}` }).click();
      await page.getByRole("menuitem", { name: "Edit" }).click();
    }
    return page.getByRole("dialog", { name: `Edit ${name}` });
  }

  async function changeRole(page: Page, isMobile: boolean, name: string, from: string, to: string) {
    const dialog = await openEdit(page, isMobile, name);
    const save = dialog.getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();
    await dialog.getByLabel("Role").click();
    await page.getByRole("option", { name: to }).click();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(confirmation(page)).toContainText(
      `${name}'s role will change from ${from} to ${to}.`,
    );
    await confirmation(page).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();
  }

  test("a role change is confirmed in the person's name", async ({ page, isMobile }, info) => {
    const name = memberEditName(info);
    await changeRole(page, isMobile, name, "Staff", "Admin");
    // Put it back, through the same confirmation.
    await changeRole(page, isMobile, name, "Admin", "Staff");
  });
});

test.describe("People cards on a phone (First glance, task 2.9)", () => {
  test.skip(({ isMobile }) => !isMobile, "cards are the phone layout");

  test.describe("the Owner", () => {
    test.use({ storageState: storageStateFor("owner") });

    test("a person's card opens their page; ⋯ opens the sheet with the actions", async ({
      page,
    }) => {
      await runInstalled(page);
      await page.goto("/people");
      await hydrated(page);
      const card = page.locator('[data-slot="data-card"]', { hasText: "Local Staff" });

      await card.getByRole("button", { name: "More for Local Staff" }).click();
      const sheet = page.locator('[data-slot="detail-sheet"]');
      await expect(sheet.getByRole("button", { name: "Edit" })).toBeVisible();
      await expect(sheet.getByRole("button", { name: "Deactivate" })).toBeVisible();
      await page.goBack();
      await expect(sheet).toBeHidden();

      await card.locator('[data-slot="data-card-link"]').click();
      await expect(page).toHaveURL(/\/people\/[^/]+$/);
      await expect(pageHeader(page)).toContainText("Local Staff");
      await page.goBack();
      await expect(page).toHaveURL(/\/people$/);
    });

    test("their own card has no person page, so it opens the sheet", async ({ page }) => {
      await page.goto("/people");
      await hydrated(page);
      const own = page.locator('[data-slot="data-card"]').first();
      await expect(own.locator('[data-slot="data-card-link"]')).toHaveCount(0);
      await own.click();
      await expect(page.locator('[data-slot="detail-sheet"]')).toBeVisible();
    });
  });

  test.describe("an Admin", () => {
    test.use({ storageState: storageStateFor("admin") });

    test("cards open the sheet: no attendance history to open", async ({ page }) => {
      await page.goto("/people");
      await hydrated(page);
      await expect(page.locator('[data-slot="data-card-link"]')).toHaveCount(0);
      await page.locator('[data-slot="data-card"]', { hasText: "Local Staff" }).click();
      await expect(page.locator('[data-slot="detail-sheet"]')).toBeVisible();
    });
  });
});

/**
 * From `md` up an action row is the last row of its card or dialog, not a bar: no background
 * band, no border, not fixed, buttons right-aligned in DOM order (Cancel, then the action). The
 * owner found a page-coloured band inside the /me card on desktop (2.9 review, 2026-09-26); the
 * fix is in the shared `StickyActions` and `MODAL_FOOTER`, so both are checked here.
 */
async function expectPlainRow(row: ReturnType<Page["locator"]>, cancel: string, action: string) {
  const look = await row.evaluate((element) => {
    const style = getComputedStyle(element);
    const buttons = [...element.querySelectorAll("button")].map((button) => ({
      text: button.textContent?.trim() ?? "",
      right: button.getBoundingClientRect().right,
    }));
    return {
      background: style.backgroundColor,
      border: style.borderTopWidth,
      position: style.position,
      rowRight: element.getBoundingClientRect().right,
      buttons,
    };
  });
  expect(look.background).toBe("rgba(0, 0, 0, 0)");
  expect(look.border).toBe("0px");
  expect(look.position).toBe("static");
  expect(look.buttons.map((button) => button.text)).toEqual([cancel, action]);
  // Right-aligned: the action ends where the row ends.
  expect(Math.abs(look.buttons[1]!.right - look.rowRight)).toBeLessThanOrEqual(1);
}

test.describe("desktop: action rows have no band", () => {
  test.skip(({ isMobile }) => isMobile, "the phone keeps its sticky bar");

  test("the /me edit row and the Request leave footer", async ({ page }, info) => {
    await signIn(page, profilePerson(info).email, PASSWORD);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/me");
      await hydrated(page);
      await editButton(page).click();
      await expectPlainRow(page.locator('[data-slot="sticky-actions"]'), "Cancel", "Save");
      await page.getByRole("button", { name: "Cancel" }).click();

      await page.goto("/leave");
      await hydrated(page);
      await page.getByRole("button", { name: "Request leave" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Request leave" });
      await expectPlainRow(
        dialog.locator('[data-slot="dialog-footer"]'),
        "Cancel",
        "Request leave",
      );
      await page.keyboard.press("Escape");
    }
  });
});
