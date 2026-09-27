import { type Page, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import {
  expectBackStack,
  hydrated,
  memberIdOf,
  pageHeader,
  removeClientFixture,
  removeFieldDefinitions,
  runInstalled,
  serviceInsert,
  storageStateFor,
  USERS,
} from "./helpers";

/**
 * Settings → Custom fields (task 3.2, WORKFLOWS §4a, PERMISSIONS ¹ ²): the Owner defines global
 * client fields and project fields, edits, archives and restores them; an Admin sees the global
 * rows read-only and adds only a field scoped to their own client; the entity tabs are view
 * controls and the add sheet closes on back (ARCHITECTURE §14.2 a, d).
 *
 * Each project owns its keys and its client (`<project>` in the name), and every block cleans
 * up first, so projects never race and the spec re-runs without a reset.
 */
const suffix = (info: TestInfo) => info.project.name.replace(/[^a-z]/g, "_");
const keys = (info: TestInfo) => ({
  industry: `industry_${suffix(info)}`,
  tier: `tier_${suffix(info)}`,
  po: `po_number_${suffix(info)}`,
  shootDays: `shoot_days_${suffix(info)}`,
});
const clientName = (info: TestInfo) => `Custom Fields Co (${info.project.name})`;

const addDialog = (page: Page) => page.getByRole("dialog", { name: "Add a field" });

/**
 * The newest "Field added" toast. A test adds several fields in a row, and a toast lives longer
 * than the steps between two adds, so two can be on screen at once (CI run 36290240327);
 * Sonner prepends new toasts, so the first match is the one this add raised.
 */
const addedToast = (page: Page) => page.getByText("Field added", { exact: true }).first();
/** The entity tabs, apart from the sidebar's own "Clients" link. */
const tabs = (page: Page) => page.getByRole("navigation", { name: "Field entity" });
const row = (page: Page, key: string) =>
  page.locator(`[data-slot="field-definition"][data-key="${key}"]`);
const archivedRow = (page: Page, key: string) =>
  page.locator(`[data-slot="archived-field-definition"][data-key="${key}"]`);

async function openAdd(page: Page) {
  await page.getByRole("button", { name: "Add field" }).first().click();
  await expect(addDialog(page)).toBeVisible();
}

test.describe("Owner", () => {
  test.use({ storageState: storageStateFor("owner") });
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({}, info) => {
    const k = keys(info);
    await removeFieldDefinitions([k.industry, k.tier, k.po]);
  });

  test("adds, edits, archives and restores fields, per entity", async ({
    page,
    isMobile,
  }, info) => {
    // The row buttons are the desktop path; a phone keeps them behind the ⋯ sheet (1.4 shape).
    test.skip(Boolean(isMobile), "drives the desktop row controls");
    const k = keys(info);
    await page.goto("/settings/custom-fields");
    await expect(pageHeader(page)).toContainText("Custom fields");
    for (const tab of ["Clients", "Contacts", "Projects", "Items"]) {
      await expect(tabs(page).getByRole("link", { name: tab, exact: true })).toBeVisible();
    }

    // A global text field: the key follows the label until typed by hand.
    await openAdd(page);
    await expect(addDialog(page).getByLabel("Applies to")).toBeVisible();
    // Admins read client fields, so money stays out of them (PRODUCT §4.16, phase 3 review).
    await expect(addDialog(page)).toContainText(
      "Admins can see this field. Amounts belong in project billing (Owner only).",
    );
    await addDialog(page)
      .getByLabel("Label")
      .fill(`Industry ${suffix(info)}`);
    await expect(addDialog(page).getByLabel("Key")).toHaveValue(k.industry);
    await addDialog(page).getByRole("button", { name: "Add field" }).click();
    await expect(addedToast(page)).toBeVisible();
    await expect(row(page, k.industry)).toContainText(`Industry ${suffix(info)}`);
    await expect(row(page, k.industry)).toContainText("Text");

    // The same key again is refused with a field message.
    await openAdd(page);
    await addDialog(page)
      .getByLabel("Label")
      .fill(`Industry ${suffix(info)}`);
    await addDialog(page).getByRole("button", { name: "Add field" }).click();
    await expect(addDialog(page)).toContainText("A field with this key already exists here.");
    await addDialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(addDialog(page)).toBeHidden();

    // A choice field needs options; a line without a key gets one from its label.
    await openAdd(page);
    await addDialog(page)
      .getByLabel("Label")
      .fill(`Tier ${suffix(info)}`);
    await addDialog(page).getByLabel("Type").click();
    await page.getByRole("option", { name: "Choice", exact: true }).click();
    await addDialog(page).getByRole("button", { name: "Add field" }).click();
    await expect(addDialog(page)).toContainText("Add at least one option");
    await addDialog(page).getByLabel("Options").fill("Gold\ng2 | Silver");
    await addDialog(page).getByRole("button", { name: "Add field" }).click();
    await expect(addedToast(page)).toBeVisible();
    await expect(row(page, k.tier)).toContainText("Choice");

    // Edit: the key is fixed, the label moves.
    await row(page, k.industry)
      .getByRole("button", { name: `Edit Industry ${suffix(info)}` })
      .click();
    const edit = page.getByRole("dialog", { name: `Edit Industry ${suffix(info)}` });
    await expect(edit.getByLabel("Key")).toBeDisabled();
    await edit.getByLabel("Label").fill(`Industry / sector ${suffix(info)}`);
    await edit.getByRole("button", { name: "Save field" }).click();
    await expect(page.getByText("Field saved")).toBeVisible();
    await expect(row(page, k.industry)).toContainText("Industry / sector");

    // Archive, then restore: never deleted.
    await row(page, k.tier)
      .getByRole("button", { name: `Archive Tier ${suffix(info)}` })
      .click();
    await page
      .getByRole("button", { name: `Archive Tier ${suffix(info)}`, exact: true })
      .last()
      .click();
    await expect(page.getByText("Field archived")).toBeVisible();
    await expect(row(page, k.tier)).toHaveCount(0);
    await expect(archivedRow(page, k.tier)).toBeVisible();
    await archivedRow(page, k.tier).getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText("Field restored")).toBeVisible();
    await expect(row(page, k.tier)).toBeVisible();

    // Projects: Owner-only, no scope picker.
    await tabs(page).getByRole("link", { name: "Projects", exact: true }).click();
    await expect(page).toHaveURL(/entity=project/);
    await openAdd(page);
    await expect(addDialog(page).getByLabel("Applies to")).toHaveCount(0);
    await addDialog(page)
      .getByLabel("Label")
      .fill(`PO number ${suffix(info)}`);
    await addDialog(page).getByRole("button", { name: "Add field" }).click();
    await expect(addedToast(page)).toBeVisible();
    await expect(row(page, k.po)).toBeVisible();
    await tabs(page).getByRole("link", { name: "Clients", exact: true }).click();
    await expect(row(page, k.po)).toHaveCount(0);
  });

  test("the tabs are view controls and the add sheet closes on back", async ({
    page,
    isMobile,
  }) => {
    if (isMobile) await runInstalled(page);
    await page.goto("/settings");
    await expect(pageHeader(page)).toBeVisible();
    await page.getByRole("link", { name: "Custom fields", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/custom-fields$/);
    await hydrated(page);
    await tabs(page).getByRole("link", { name: "Contacts", exact: true }).click();
    await expect(page).toHaveURL(/entity=contact/);
    await tabs(page).getByRole("link", { name: "Projects", exact: true }).click();
    await expect(page).toHaveURL(/entity=project/);
    await openAdd(page);
    await expectBackStack(page, [
      { closes: addDialog(page), url: /entity=project/ },
      { url: /\/settings$/ },
    ]);
  });
});

test.describe("Admin", () => {
  test.use({ storageState: storageStateFor("admin") });
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({}, info) => {
    const k = keys(info);
    await removeFieldDefinitions([k.shootDays]);
    await removeClientFixture(clientName(info));
    await serviceInsert("clients", {
      name: clientName(info),
      admin_id: await memberIdOf(USERS.admin.email),
    });
  });

  test.afterAll(async ({}, info) => {
    await removeClientFixture(clientName(info));
  });

  test("defines fields for their own client only", async ({ page }, info) => {
    const k = keys(info);
    await page.goto("/settings/custom-fields");
    await expect(pageHeader(page)).toContainText("Custom fields");
    await expect(tabs(page).getByRole("link", { name: "Clients", exact: true })).toBeVisible();
    await expect(tabs(page).getByRole("link", { name: "Projects", exact: true })).toHaveCount(0);

    await openAdd(page);
    await addDialog(page).getByLabel("Applies to").click();
    await expect(page.getByRole("option", { name: "Every client" })).toHaveCount(0);
    await page.getByRole("option", { name: `${clientName(info)} only` }).click();
    await addDialog(page)
      .getByLabel("Label")
      .fill(`Shoot days ${suffix(info)}`);
    await addDialog(page).getByLabel("Type").click();
    await page.getByRole("option", { name: "Number", exact: true }).click();
    await addDialog(page).getByRole("button", { name: "Add field" }).click();
    await expect(addedToast(page)).toBeVisible();
    const group = page.locator('[data-slot="field-group"]', {
      hasText: `${clientName(info)} only`,
    });
    await expect(group.locator(`[data-key="${k.shootDays}"]`)).toContainText("Number");
    // A global row (the Owner's) offers no Edit or Archive to an Admin.
    const global = page.locator('[data-slot="field-group"]', { hasText: "Every client" });
    await expect(global.getByRole("button", { name: /^(Edit|Archive) / })).toHaveCount(0);
  });
});
