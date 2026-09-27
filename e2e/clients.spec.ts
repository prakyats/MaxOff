import { type Page, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import {
  expectBackStack,
  hydrated,
  memberIdOf,
  pageHeader,
  removeClientFixture,
  rpcAs,
  runInstalled,
  serviceInsert,
  serviceSelect,
  storageStateFor,
  USERS,
} from "./helpers";

/**
 * The client screens (task 3.4, PRODUCT §4.4, kickoff 3 decisions 17-18): the list with its
 * search and filters (the Owner's opens on Active), "New client", the page's views (Overview,
 * Brand, Activity), details, contacts, brand and the Owner's notes through the edit pattern, the
 * Owner's lifecycle and Admin assignment behind ⋯ with named confirmations, the state banner, an
 * Admin's scope, Staff kept out, and the back order of every new screen and overlay installed at
 * 375 and 430 px (§14.2).
 *
 * Every client is named for its test and project and removed first (`removeClientFixture`), so
 * projects never race and the spec re-runs on a used database.
 */
const nameOf = (info: TestInfo, what: string) => `Test Client ${what} (${info.project.name})`;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DwHwyBBAMDABbdBP38ONcyAAAAAElFTkSuQmCC",
  "base64",
);

/** A draft client made through the service role (a fixture), optionally run by an Admin. */
async function seedClient(name: string, adminEmail?: string): Promise<string> {
  await removeClientFixture(name);
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  const row = await serviceInsert<{ id: string }>("clients", {
    org_id: org?.id,
    name,
    admin_id: adminEmail ? await memberIdOf(adminEmail) : null,
  });
  return row.id;
}

async function activateAsOwner(clientId: string): Promise<void> {
  await rpcAs(USERS.owner.email, USERS.owner.password, "client_activate", { client_id: clientId });
}

const record = (page: Page, title: string) =>
  page.locator('[data-slot="editable-record"]', {
    has: page.getByRole("heading", { name: title, exact: true }),
  });
const confirmation = (page: Page) => page.getByRole("alertdialog", { name: "Save these changes?" });
const banner = (page: Page) => page.locator('[data-slot="client-state-banner"]');
const menu = (page: Page, name: string) =>
  page.getByRole("button", { name: `Actions for ${name}`, exact: true });

async function openClient(page: Page, clientId: string, name: string) {
  await page.goto(`/clients/${clientId}`);
  await expect(pageHeader(page)).toContainText(name);
  await hydrated(page);
}

test.describe("the Owner", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("creates a client, which starts as a draft and opens its page", async ({ page }, info) => {
    const name = nameOf(info, "New");
    await removeClientFixture(name);
    await page.goto("/clients");
    await hydrated(page);
    await page.getByRole("button", { name: "New client" }).click();
    const sheet = page.getByRole("dialog", { name: "New client" });
    // The name is the one required detail.
    await sheet.getByRole("button", { name: "Create client" }).click();
    await expect(sheet).toContainText("A client name is required.");
    await sheet.getByLabel("Client name").fill(name);
    await sheet.getByRole("button", { name: "Create client" }).click();

    await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
    await expect(pageHeader(page)).toContainText(name);
    await expect(banner(page)).toContainText("Not active yet");
    // Back from the new client returns to the list, never to the form (§14.2 e).
    await page.goBack();
    await expect(page).toHaveURL(/\/clients$/);
    await expect(sheet).toBeHidden();
  });

  test("the list opens on Active; search and the state filter find the rest", async ({
    page,
  }, info) => {
    const draft = nameOf(info, "Drafty");
    const active = nameOf(info, "Livewire");
    await seedClient(draft);
    await activateAsOwner(await seedClient(active, USERS.admin.email));

    await page.goto("/clients");
    await hydrated(page);
    const search = page.locator('[data-slot="data-search"] input');
    await search.fill(`(${info.project.name})`);
    const list = page.locator(
      info.project.name === "desktop" ? "table" : '[data-slot="data-cards"]',
    );
    await expect(list).toContainText(active);
    await expect(list).not.toContainText(draft);
    // Search text never enters the URL (ARCHITECTURE §18.2, phase 3 review).
    await expect(page).not.toHaveURL(/q=/);

    await page.locator('[data-filter="state"]').click();
    await page.getByRole("option", { name: "All states" }).click();
    await expect(list).toContainText(draft);
    await expect(page).toHaveURL(/state=all/);
    await expect(page).not.toHaveURL(/q=/);

    await search.fill("nothing like this at all");
    await expect(page.getByText("No clients match")).toBeVisible();
    // "Show everything" empties the search and widens every filter.
    await page.getByRole("button", { name: "Show everything" }).click();
    await expect(search).toHaveValue("");
    await expect(page.locator('[data-filter="state"]')).toHaveText("All states");
    await expect(page).not.toHaveURL(/q=/);
  });

  test("edits the details through the edit pattern, naming each change", async ({ page }, info) => {
    const name = nameOf(info, "Details");
    const id = await seedClient(name);
    await openClient(page, id, name);
    const details = record(page, "Details");
    await expect(details.getByRole("textbox")).toHaveCount(0);

    await details.locator('[data-slot="edit-record"]').click();
    await page.getByLabel("GSTIN").fill("12345");
    await page.getByLabel("Website").fill("http://sharma.example");
    await details.locator('[data-slot="save-record"]').click();
    await confirmation(page).getByRole("button", { name: "Save" }).click();
    // Refused under their fields (kickoff 3 decision 5), still in edit mode.
    await expect(details).toContainText("A GSTIN is 15 characters");
    await expect(details).toContainText("Enter a full https:// link.");

    await page.getByLabel("GSTIN").fill("29ABCDE1234F1Z5");
    await page.getByLabel("Website").fill("https://sharma.example");
    await page.getByLabel("Google Drive folder").fill("https://drive.google.com/drive/folders/x");
    await details.locator('[data-slot="save-record"]').click();
    await expect(confirmation(page)).toContainText(
      `${name}'s website will be set to https://sharma.example.`,
    );
    await expect(confirmation(page)).toContainText(
      `${name}'s GSTIN will be set to 29ABCDE1234F1Z5.`,
    );
    await confirmation(page).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Details saved")).toBeVisible();
    await expect(details.locator('[data-slot="record-link"]').first()).toHaveAttribute(
      "href",
      "https://sharma.example",
    );
    // The Drive folder is on the first glance, opening in a new tab.
    await expect(page.locator('[data-slot="drive-link"]')).toHaveAttribute("target", "_blank");

    // The Owner's own notes, and the history names who did what.
    const notes = record(page, "Owner's notes");
    await notes.locator('[data-slot="edit-record"]').click();
    await page.getByLabel("Only you see these").fill("Pays late, always polite.");
    await notes.locator('[data-slot="save-record"]').click();
    await confirmation(page).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Notes saved")).toBeVisible();

    await page.locator('[data-slot="client-tabs"]').getByRole("link", { name: "Activity" }).click();
    await expect(page).toHaveURL(/\/activity$/);
    const history = page.locator('[data-slot="client-activity"]');
    await expect(history).toContainText("changed the GSTIN, website and Drive link");
    await expect(history).toContainText("changed the Owner's notes");
  });

  test("assigns an Admin and moves the client through its life, each confirmed by name", async ({
    page,
  }, info) => {
    const name = nameOf(info, "Lifecycle");
    const id = await seedClient(name);
    await openClient(page, id, name);

    // No Admin yet: Activate is not offered, the assignment is.
    await menu(page, name).click();
    await expect(page.getByRole("menuitem", { name: "Activate" })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Assign Admin" }).click();
    const assign = page.getByRole("alertdialog", { name: `Assign an Admin to ${name}` });
    await assign.getByRole("combobox").click();
    await page.getByRole("option", { name: "Local Admin" }).click();
    await assign.getByRole("button", { name: "Make Local Admin the Admin" }).click();
    await expect(page.getByText(`Local Admin runs ${name} now`)).toBeVisible();

    await menu(page, name).click();
    await page.getByRole("menuitem", { name: "Activate" }).click();
    await page.getByRole("button", { name: `Activate ${name}` }).click();
    await expect(banner(page)).toHaveCount(0);

    await menu(page, name).click();
    await page.getByRole("menuitem", { name: "Pause" }).click();
    await page.getByRole("button", { name: `Pause ${name}` }).click();
    await expect(banner(page)).toContainText("Paused");
    // Paused stays editable (kickoff 3 decision 17).
    await expect(record(page, "Details").locator('[data-slot="edit-record"]')).toBeVisible();

    await menu(page, name).click();
    await page.getByRole("menuitem", { name: "Close" }).click();
    const close = page.getByRole("alertdialog", { name: `Close ${name}?` });
    await close.getByLabel("Reason (optional)").fill("Moved to another studio");
    await close.getByRole("button", { name: `Close ${name}` }).click();
    await expect(banner(page)).toContainText("Inactive");

    await page.locator('[data-slot="client-tabs"]').getByRole("link", { name: "Activity" }).click();
    const history = page.locator('[data-slot="client-activity"]');
    await expect(history).toContainText("made Local Admin the Admin");
    await expect(history).toContainText("paused the client");
    await expect(history).toContainText("closed the client");
    await expect(history).toContainText("Moved to another studio");

    await menu(page, name).click();
    await page.getByRole("menuitem", { name: "Reactivate" }).click();
    await page.getByRole("button", { name: `Reactivate ${name}` }).click();
    await expect(banner(page)).toHaveCount(0);
  });

  test("contacts: the first is primary, archiving the primary asks who takes over", async ({
    page,
  }, info) => {
    const name = nameOf(info, "Contacts");
    const id = await seedClient(name);
    await openClient(page, id, name);

    for (const person of ["Meera Rao", "Arjun Das"]) {
      await page.getByRole("button", { name: "Add contact" }).click();
      const sheet = page.getByRole("dialog", { name: "Add a contact" });
      await sheet.getByLabel("Name").fill(person);
      await sheet.getByLabel("Phone").fill("98450 12345");
      await sheet.getByRole("button", { name: "Add contact" }).click();
      await expect(page.getByText(`${person} added`)).toBeVisible();
      await expect(sheet).toBeHidden();
    }
    const rows = page.locator('[data-slot="contact-row"]');
    await expect(rows.filter({ hasText: "Meera Rao" })).toContainText("Primary");
    await expect(page.locator('[data-slot="call-primary"]')).toHaveAttribute(
      "href",
      "tel:9845012345",
    );

    await rows.filter({ hasText: "Meera Rao" }).click();
    await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]{36}$/);
    await hydrated(page);
    await menu(page, "Meera Rao").click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    const archive = page.getByRole("alertdialog", { name: "Archive Meera Rao?" });
    await archive.getByRole("button", { name: "Archive Meera Rao" }).click();
    await expect(archive).toContainText("Choose the next primary contact.");
    await archive.getByRole("combobox").click();
    await page.getByRole("option", { name: "Arjun Das" }).click();
    await archive.getByRole("button", { name: "Archive Meera Rao" }).click();
    await expect(page.getByText("Meera Rao is archived")).toBeVisible();

    // A dialog closed by its button leaves its history entry spent (1.5, overlay-history), so the
    // client is opened directly rather than by a back press that would land here first.
    await page.goto(`/clients/${id}`);
    await expect(rows.filter({ hasText: "Arjun Das" })).toContainText("Primary");
    await expect(rows.filter({ hasText: "Meera Rao" })).toContainText("Archived");
  });

  test("the brand: a swatch list and a font list, and a logo the list shows", async ({
    page,
    context,
  }, info) => {
    const name = nameOf(info, "Brand");
    const id = await seedClient(name);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`/clients/${id}/brand`);
    await expect(pageHeader(page)).toContainText(name);
    await hydrated(page);

    const brand = record(page, "Brand");
    await expect(brand).toContainText("No colours yet");
    await brand.locator('[data-slot="edit-record"]').click();
    await brand.getByRole("button", { name: "Add colour" }).click();
    await page.getByLabel("Colour 1 name", { exact: true }).fill("Primary");
    // The hex field takes what is typed or pasted as # and six upper-case digits.
    await page.getByLabel("Colour 1 hex", { exact: true }).fill("e11d48");
    await expect(page.getByLabel("Colour 1 hex", { exact: true })).toHaveValue("#E11D48");
    await brand.getByRole("button", { name: "Add colour" }).click();
    await page.getByLabel("Colour 2 hex", { exact: true }).fill("#11");
    await brand.locator('[data-slot="save-record"]').click();
    await confirmation(page).getByRole("button", { name: "Save" }).click();
    // Each refusal sits under its own row.
    const second = brand.locator('[data-slot="brand-color-row"]').nth(1);
    await expect(second).toContainText("Name the colour.");
    await expect(second).toContainText("A colour is a 6-digit hex value like #E11D48.");

    await page.getByLabel("Colour 2 name", { exact: true }).fill("Ink");
    await page.getByLabel("Colour 2 hex", { exact: true }).fill("111111");
    await brand.getByRole("button", { name: "Move colour 2 up" }).click();
    await expect(page.getByLabel("Colour 1 name", { exact: true })).toHaveValue("Ink");
    await brand.getByRole("button", { name: "Add font" }).click();
    await page.getByLabel("Font 1 name", { exact: true }).fill("Inter");
    await page.getByLabel("Font 1 note", { exact: true }).fill("headings");
    await brand.locator('[data-slot="save-record"]').click();
    await expect(confirmation(page)).toContainText(`${name}'s colour Ink #111111 will be added.`);
    await expect(confirmation(page)).toContainText(
      `${name}'s colour Primary #E11D48 will be added.`,
    );
    await expect(confirmation(page)).toContainText(
      `${name}'s font Inter (headings) will be added.`,
    );
    await confirmation(page).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Brand saved")).toBeVisible();

    // Read mode: a swatch per colour (chip, name, hex) in order; a tap copies the hex.
    const swatches = brand.locator('[data-slot="brand-color"]');
    await expect(swatches).toHaveCount(2);
    await expect(swatches.first()).toContainText("Ink");
    await expect(swatches.nth(1)).toContainText("#E11D48");
    await expect(brand.locator('[data-slot="brand-font"]')).toContainText("Inter");
    await expect(brand.locator('[data-slot="brand-font"]')).toContainText("headings");
    await swatches.nth(1).click();
    await expect(page.getByText("Copied #E11D48")).toBeVisible();

    // A removal is named too.
    await brand.locator('[data-slot="edit-record"]').click();
    await brand.getByRole("button", { name: "Remove colour 1" }).click();
    await brand.locator('[data-slot="save-record"]').click();
    await expect(confirmation(page)).toContainText(`${name}'s colour Ink #111111 will be removed.`);
    await confirmation(page).getByRole("button", { name: "Save" }).click();
    await expect(swatches).toHaveCount(1);

    await page.getByRole("button", { name: "Add logo" }).click();
    const sheet = page.locator('[data-slot="image-upload-sheet"]');
    await page
      .locator('[data-slot="image-upload-input"]')
      .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
    await sheet.getByRole("button", { name: "Save logo" }).click();
    await expect(page.getByText(`${name} logo saved`)).toBeVisible();
    await expect(page.locator('[data-slot="client-brand"] [data-slot="file-image"]')).toBeVisible();

    await page.goto("/clients?state=all");
    await page.locator('[data-slot="data-search"] input').fill(name);
    const shown = page.locator('[data-slot="file-image"]').filter({ visible: true }).first();
    await expect(shown).toBeVisible();
  });
});

test.describe("an Admin", () => {
  test.use({ storageState: storageStateFor("admin") });

  test("sees their client, edits it, and never the Owner's notes or lifecycle", async ({
    page,
  }, info) => {
    const mine = nameOf(info, "Admins own");
    const other = nameOf(info, "Not theirs");
    const id = await seedClient(mine, USERS.admin.email);
    await activateAsOwner(id);
    await rpcAs(USERS.owner.email, USERS.owner.password, "client_pause", { client_id: id });
    const otherId = await seedClient(other);

    await page.goto("/clients");
    await hydrated(page);
    await expect(page.getByRole("button", { name: "New client" })).toHaveCount(0);
    await page.locator('[data-slot="data-search"] input').fill(`(${info.project.name})`);
    const list = page.locator(
      info.project.name === "desktop" ? "table" : '[data-slot="data-cards"]',
    );
    // An Admin's list opens on Active too (3B review): the paused client waits behind "All
    // states"; another Admin's client never shows.
    await expect(page.locator('[data-filter="state"]')).toHaveText("Active");
    await expect(list).not.toContainText(mine);
    await page.locator('[data-filter="state"]').click();
    await page.getByRole("option", { name: "All states" }).click();
    await expect(list).toContainText(mine);
    await expect(list).not.toContainText(other);

    await openClient(page, id, mine);
    await expect(banner(page)).toContainText("Only the Owner can change this.");
    await expect(page.getByText("Owner's notes")).toHaveCount(0);
    await menu(page, mine).click();
    await expect(page.getByRole("menuitem", { name: "Edit details" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Admin|Pause|Close|Activate/ })).toHaveCount(0);
    // Edit details from the ⋯ starts the edit pattern.
    await page.getByRole("menuitem", { name: "Edit details" }).click();
    await page.getByLabel("City").fill("Mangaluru");
    await record(page, "Details").locator('[data-slot="save-record"]').click();
    await expect(confirmation(page)).toContainText(`${mine}'s city will be set to Mangaluru.`);
    await confirmation(page).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Details saved")).toBeVisible();

    // Another Admin's client, or none of theirs, is not found.
    await page.goto(`/clients/${otherId}`);
    await expect(page.getByText("Page not found")).toBeVisible();
  });
});

test.describe("Staff", () => {
  test.use({ storageState: storageStateFor("staff") });

  test("cannot open Clients", async ({ page }) => {
    await page.goto("/clients");
    await expect(page).toHaveURL(/\/forbidden$/);
  });
});

test.describe("installed on a phone: the back order of the client screens (§14.2)", () => {
  test.use({ storageState: storageStateFor("owner") });
  test.skip(({ isMobile }) => !isMobile, "the installed app is a phone");

  test("list → client → views and filters → one back each", async ({ page }, info) => {
    const name = nameOf(info, "Back");
    const id = await seedClient(name);
    await runInstalled(page);
    await page.goto("/today");
    await page.goto("/clients");
    await hydrated(page);

    // Filters and search are view controls: no history.
    await page.locator('[data-filter="state"]').click();
    const options = page.getByRole("listbox");
    await expect(options).toBeVisible();
    // Back closes the open select first (§14.2 a).
    await page.goBack();
    await expect(options).toBeHidden();
    await expect(page).toHaveURL(/\/clients$/);
    await page.locator('[data-filter="state"]').click();
    await page.getByRole("option", { name: "All states" }).click();
    await page.locator('[data-slot="data-search"] input').fill(name);

    const card = page.locator('[data-slot="data-card"]', { hasText: name });
    // ⋯ opens the Owner's sheet; back closes it.
    await card.getByRole("button", { name: `More for ${name}` }).click();
    const sheet = page.locator('[data-slot="detail-sheet"]');
    await expect(sheet.getByRole("button", { name: "Assign Admin" })).toBeVisible();
    await expectBackStack(page, [{ closes: sheet, url: /\/clients\?/ }]);

    await card.locator('[data-slot="data-card-link"]').click();
    await expect(page).toHaveURL(new RegExp(`/clients/${id}$`));
    await hydrated(page);
    const tabs = page.locator('[data-slot="client-tabs"]');
    await tabs.getByRole("link", { name: "Brand" }).click();
    await expect(page).toHaveURL(/\/brand$/);
    await tabs.getByRole("link", { name: "Activity" }).click();
    await expect(page).toHaveURL(/\/activity$/);

    // The header's ⋯ is a layer.
    await menu(page, name).click();
    const items = page.getByRole("menu");
    await expect(items).toBeVisible();
    // Edit details from another view switches to Overview (a replace) and starts editing.
    await page.getByRole("menuitem", { name: "Edit details" }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/${id}$`));
    await expect(record(page, "Details").locator('[data-slot="save-record"]')).toBeVisible();
    // Back with nothing changed leaves edit mode; the next back leaves the client for the list.
    await page.goBack();
    await expect(record(page, "Details").locator('[data-slot="edit-record"]')).toBeVisible();
    await expectBackStack(page, [{ url: /\/clients\?/ }, { url: /\/today$/ }]);
  });

  test("the New client and Add contact sheets close on back", async ({ page }, info) => {
    const name = nameOf(info, "Sheets");
    const id = await seedClient(name);
    await runInstalled(page);
    await page.goto("/clients");
    await hydrated(page);
    await page.getByRole("button", { name: "New client" }).click();
    const create = page.getByRole("dialog", { name: "New client" });
    await expect(create).toBeVisible();
    await expectBackStack(page, [{ closes: create, url: /\/clients$/ }]);

    await page.goto(`/clients/${id}`);
    await hydrated(page);
    await page.getByRole("button", { name: "Add contact" }).click();
    const add = page.getByRole("dialog", { name: "Add a contact" });
    await expect(add).toBeVisible();
    await expectBackStack(page, [{ closes: add, url: new RegExp(`/clients/${id}$`) }]);
  });

  test("a contact is one level deeper; back returns to the client", async ({ page }, info) => {
    const name = nameOf(info, "Contact back");
    const id = await seedClient(name);
    const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
    // The first live contact of a client is its primary one (by trigger).
    await serviceInsert("client_contacts", {
      org_id: org?.id,
      client_id: id,
      name: "Kavya Shetty",
    });
    await runInstalled(page);
    await page.goto(`/clients/${id}`);
    await hydrated(page);
    await page.locator('[data-slot="contact-row"]', { hasText: "Kavya Shetty" }).click();
    await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]{36}$/);
    await hydrated(page);
    // Edit from the contact's ⋯; back leaves edit mode, then the contact.
    await menu(page, "Kavya Shetty").click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await expect(record(page, "Contact").locator('[data-slot="save-record"]')).toBeVisible();
    await page.goBack();
    await expect(record(page, "Contact").locator('[data-slot="edit-record"]')).toBeVisible();
    await expectBackStack(page, [{ url: new RegExp(`/clients/${id}$`) }]);
  });
});
