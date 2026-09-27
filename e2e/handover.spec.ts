import { type Page, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import {
  expectBackStack,
  hydrated,
  memberIdOf,
  pageHeader,
  removeClientFixture,
  runInstalled,
  serviceInsert,
  serviceSelect,
  serviceUpdate,
  storageStateFor,
  USERS,
} from "./helpers";

/**
 * Phase 3 review (owner decision 2026-09-27): no client is ever left without an Admin. Making an
 * Admin Staff, or deactivating them, asks in the same confirmation where their clients go ("Move
 * Ravi's 2 clients to: [Admin ▾]", one pick for all or per client), moves them, then applies the
 * change. Each project has its own seeded Admin (`handover-<project>@`); the spec names its
 * clients per project, removes them first, and puts the person's role and status back itself.
 */
// Every test in a project uses that project's one person: one at a time.
test.describe.configure({ mode: "serial" });

const personOf = (info: TestInfo) => ({
  email: `handover-${info.project.name}@maxoff.local`,
  name: `Test Handover (${info.project.name})`,
});
const clientName = (info: TestInfo, what: string) => `Test Handover ${what} (${info.project.name})`;

const confirmation = (page: Page) => page.getByRole("alertdialog", { name: "Save these changes?" });
const record = (page: Page) =>
  page.locator('[data-slot="editable-record"]', {
    has: page.getByRole("heading", { name: "Profile", exact: true }),
  });

const CLIENTS = ["Role", "One", "Two", "Back"];

/** The person back to an active Admin running none of this spec's clients (a failed run's too). */
async function resetPerson(info: TestInfo): Promise<string> {
  for (const what of CLIENTS) await removeClientFixture(clientName(info, what));
  const id = await memberIdOf(personOf(info).email);
  await serviceUpdate(`members?id=eq.${id}`, {
    role: "admin",
    status: "active",
    deactivated_at: null,
  });
  return id;
}

async function seedClient(name: string, adminId: string): Promise<string> {
  await removeClientFixture(name);
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  const row = await serviceInsert<{ id: string }>("clients", {
    org_id: org?.id,
    name,
    admin_id: adminId,
  });
  return row.id;
}

async function adminOf(clientId: string): Promise<string | null> {
  const [row] = await serviceSelect<{ admin_id: string | null }>(
    `clients?id=eq.${clientId}&select=admin_id`,
  );
  return row?.admin_id ?? null;
}

async function openPerson(page: Page, id: string, name: string) {
  await page.goto(`/people/${id}`);
  await expect(pageHeader(page)).toContainText(name);
  await hydrated(page);
}

/** Edit → Role: Staff → Save, up to the confirmation. */
async function demote(page: Page, name: string) {
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.getByLabel("Role").click();
  await page.getByRole("option", { name: "Staff" }).click();
  await record(page).locator('[data-slot="save-record"]').click();
  await expect(confirmation(page)).toContainText(`${name}'s role will change from Admin to Staff.`);
}

test.describe("the Owner hands an Admin's clients over", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("before making them Staff, in the same confirmation", async ({ page }, info) => {
    const person = personOf(info);
    const id = await resetPerson(info);
    const client = await seedClient(clientName(info, "Role"), id);
    await openPerson(page, id, person.name);

    await demote(page, person.name);
    const save = confirmation(page).getByRole("button", { name: "Save" });
    const move = confirmation(page).getByLabel(`Move ${person.name}'s 1 client to`);
    await expect(move).toBeVisible();
    // Save waits for the choice: no client is left without an Admin.
    await expect(save).toBeDisabled();
    await move.click();
    await page.getByRole("option", { name: "Local Admin", exact: true }).click();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect(record(page)).toContainText("Staff");
    expect(await adminOf(client)).toBe(await memberIdOf(USERS.admin.email));

    await resetPerson(info);
  });

  test("before deactivating them, one Admin for all or per client", async ({ page }, info) => {
    const person = personOf(info);
    const id = await resetPerson(info);
    const first = await seedClient(clientName(info, "One"), id);
    const second = await seedClient(clientName(info, "Two"), id);
    await openPerson(page, id, person.name);

    await page.getByRole("button", { name: `Actions for ${person.name}` }).click();
    await page.getByRole("menuitem", { name: "Deactivate" }).click();
    const dialog = page.getByRole("dialog", { name: `Deactivate ${person.name}?` });
    const commit = dialog.getByRole("button", { name: `Deactivate ${person.name}` });
    await expect(dialog.getByLabel(`Move ${person.name}'s 2 clients to`)).toBeVisible();
    await expect(commit).toBeDisabled();
    await dialog.getByLabel(`Move ${person.name}'s 2 clients to`).click();
    await page.getByRole("option", { name: "Local Admin", exact: true }).click();
    await expect(commit).toBeEnabled();
    // Per client: each row starts on the Admin chosen for all.
    await dialog.getByRole("button", { name: "Choose per client" }).click();
    await expect(dialog.getByLabel(clientName(info, "One"))).toContainText("Local Admin");
    await expect(dialog.getByLabel(clientName(info, "Two"))).toContainText("Local Admin");
    await commit.click();
    await expect(dialog).toBeHidden();

    const adminId = await memberIdOf(USERS.admin.email);
    expect(await adminOf(first)).toBe(adminId);
    expect(await adminOf(second)).toBe(adminId);
    const [row] = await serviceSelect<{ status: string }>(`members?id=eq.${id}&select=status`);
    expect(row?.status).toBe("deactivated");

    await resetPerson(info);
  });
});

test.describe("installed on a phone: the hand-over's back order (§14.2)", () => {
  test.use({ storageState: storageStateFor("owner") });
  test.skip(({ isMobile }) => !isMobile, "the installed back gesture is a phone behaviour");

  test("select sheet → confirmation → edit mode; select sheet → deactivate dialog → page", async ({
    page,
  }, info) => {
    const person = personOf(info);
    const id = await resetPerson(info);
    await seedClient(clientName(info, "Back"), id);
    await runInstalled(page);
    await openPerson(page, id, person.name);
    const here = new RegExp(`/people/${id}$`);
    const sheet = page.locator('[data-slot="select-sheet"]');

    await demote(page, person.name);
    await confirmation(page).getByLabel(`Move ${person.name}'s 1 client to`).click();
    await expect(sheet).toBeVisible();
    await expectBackStack(page, [
      { closes: sheet, url: here },
      { closes: confirmation(page), url: here },
    ]);
    // Still in edit mode with the change: leave it through Cancel → Discard.
    await record(page).getByRole("button", { name: "Cancel" }).click();
    await page
      .getByRole("alertdialog", { name: "Discard changes?" })
      .getByRole("button", { name: "Discard changes" })
      .click();

    await page.getByRole("button", { name: `Actions for ${person.name}` }).click();
    await page.getByRole("menuitem", { name: "Deactivate" }).click();
    const dialog = page.getByRole("dialog", { name: `Deactivate ${person.name}?` });
    await dialog.getByLabel(`Move ${person.name}'s 1 client to`).click();
    await expect(sheet).toBeVisible();
    await expectBackStack(page, [
      { closes: sheet, url: here },
      { closes: dialog, url: here },
    ]);
    await expect(pageHeader(page)).toContainText(person.name);

    await resetPerson(info);
  });
});
