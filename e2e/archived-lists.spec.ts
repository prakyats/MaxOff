import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  hydrated,
  insertAs,
  removeClientFixture,
  rpcAs,
  serviceInsert,
  serviceRest,
  serviceSelect,
  storageStateFor,
  taskTypeId,
  USERS,
} from "./helpers";

/**
 * Every list with Archive keeps what it archived (V5b-0 item 9; the owner's preview bug of
 * 2026-10-22: an archived stage preset vanished from Settings → Templates with no way back).
 * For each list, as the Owner on a laptop: Archive a row → it waits under the collapsed
 * "Archived (n)" at its section's foot → Restore brings it back into the list.
 */
type ListCase = {
  /** What the list holds, for the test's title. */
  kind: string;
  /** Where the list lives. */
  path: string;
  /** The table the fixture row goes into. */
  table: string;
  /** The column the row is named by. */
  nameColumn: string;
  /** The rest of the fixture row (the org, its author). */
  row: (context: { orgId: string }) => Promise<Record<string, unknown>>;
  /** The archive confirmation asks for a reason (a deliverable template's, invariant 9). */
  reason?: boolean;
  /** Written by the Owner's own session: a template is its author's (the tables' guards). */
  asOwner?: boolean;
};

const LISTS: ListCase[] = [
  {
    kind: "a job title",
    path: "/settings/job-titles",
    table: "list_items",
    nameColumn: "name",
    row: async ({ orgId }) => ({ org_id: orgId, list_key: "job_title", position: "y5" }),
  },
  {
    kind: "an expense category",
    path: "/settings/expenses",
    table: "list_items",
    nameColumn: "name",
    row: async ({ orgId }) => ({ org_id: orgId, list_key: "expense_category", position: "y5" }),
  },
  {
    kind: "a task type",
    path: "/settings/task-types",
    table: "task_types",
    nameColumn: "name",
    row: async ({ orgId }) => ({ org_id: orgId, position: "y5" }),
  },
  {
    kind: "a custom field",
    path: "/settings/custom-fields?entity=task",
    table: "field_definitions",
    nameColumn: "label",
    row: async ({ orgId }) => ({
      org_id: orgId,
      entity: "task",
      key: "archived_list_fixture",
      type: "text",
      position: "y5",
    }),
  },
  {
    kind: "a stage preset",
    path: "/settings/templates",
    table: "stage_presets",
    asOwner: true,
    nameColumn: "name",
    row: async () => ({ stages: ["Shoot", "Edit"] }),
  },
  {
    kind: "a deliverable template",
    path: "/settings/templates",
    table: "deliverable_templates",
    asOwner: true,
    nameColumn: "name",
    row: async () => ({}),
    reason: true,
  },
  {
    kind: "a project template",
    path: "/settings/templates",
    table: "project_templates",
    asOwner: true,
    nameColumn: "name",
    row: async () => ({ recurrence: "one_time" }),
  },
  {
    kind: "a task template",
    path: "/settings/templates",
    table: "task_templates",
    asOwner: true,
    nameColumn: "name",
    row: async () => ({ task_type_id: await taskTypeId("Normal") }),
  },
];

/** The "Archived (n)" section that holds `name` (a page may have one per section). */
function archivedSectionOf(page: Page, name: string) {
  return page.locator('[data-slot="archived-section"]', {
    has: page.locator('[data-slot="archived-item"]', { hasText: name }),
  });
}

async function removeFixture(list: ListCase, name: string) {
  await serviceRest(`${list.table}?${list.nameColumn}=eq.${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

test.describe("every list with Archive keeps what it archived (V5b-0 item 9)", () => {
  test.use({ storageState: storageStateFor("owner") });
  test.skip(({ isMobile }) => Boolean(isMobile), "these drive the laptop's row controls");

  for (const list of LISTS) {
    test(`${list.kind}: archive → under Archived → Restore → back in the list`, async ({
      page,
    }, info) => {
      const name = `Archived list ${list.kind.split(" ").slice(1).join(" ")} ${info.project.name}`;
      await removeFixture(list, name);
      const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
      const row = await list.row({ orgId: org!.id });
      if (list.asOwner) {
        await insertAs(USERS.owner.email, USERS.owner.password, list.table, {
          ...row,
          [list.nameColumn]: name,
        });
      } else {
        await serviceInsert(list.table, { ...row, [list.nameColumn]: name });
      }
      try {
        await page.goto(list.path);
        const archive = page.getByRole("button", { name: `Archive ${name}`, exact: true });
        await archive.click();
        const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog")).last();
        if (list.reason) await confirm.getByRole("textbox").fill("No longer offered");
        await confirm.getByRole("button", { name: `Archive ${name}`, exact: true }).click();
        await expect(confirm).toBeHidden();
        await expect(archive).toHaveCount(0);

        // It waits under its section's "Archived (n)", collapsed until opened.
        const section = archivedSectionOf(page, name);
        await expect(section).toHaveCount(1);
        const item = section.locator('[data-slot="archived-item"]', { hasText: name });
        await expect(item).toBeHidden();
        await section.locator('[data-slot="archived-toggle"]').click();
        await expect(item).toBeVisible();

        await item.getByRole("button", { name: `Restore ${name}`, exact: true }).click();
        await expect(page.getByText(`${name} restored`)).toBeVisible();
        await expect(archive).toBeVisible();
        await expect(page.locator('[data-slot="archived-item"]', { hasText: name })).toHaveCount(0);
      } finally {
        await removeFixture(list, name);
      }
    });
  }
});

/**
 * A client's contacts (advisor audit, v1.8): an archived contact leaves the Overview's list for
 * the same collapsed "Archived (n)", where Restore brings it back and the Owner's Delete (its
 * confirmation checks that nothing ever pointed at it) removes it for good. Archived through
 * `client_contact_archive`, as the contact's own ⋯ does.
 */
test.describe("a client's archived contacts", () => {
  test.use({ storageState: storageStateFor("owner") });
  test.skip(({ isMobile }) => Boolean(isMobile), "these drive the laptop's row controls");

  test("a contact: archived → under Archived → Restore → back; archived again → Delete", async ({
    page,
  }, info) => {
    const client = `Archived list contacts client (${info.project.name})`;
    const name = `Archived list contact ${info.project.name}`;
    await removeClientFixture(client);
    const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
    const { id: clientId } = await serviceInsert<{ id: string }>("clients", {
      org_id: org!.id,
      name: client,
    });
    const contact = async (person: string) =>
      (
        await serviceInsert<{ id: string }>("client_contacts", {
          org_id: org!.id,
          client_id: clientId,
          name: person,
        })
      ).id;
    // The first live contact is the primary one (by trigger); the second is the one archived.
    await contact("Kept Primary");
    const contactId = await contact(name);
    const archiveIt = () =>
      rpcAs(USERS.owner.email, USERS.owner.password, "client_contact_archive", {
        contact_id: contactId,
      });
    try {
      await archiveIt();
      await page.goto(`/clients/${clientId}`);
      await hydrated(page);
      const live = page.locator('[data-slot="contact-row"]', { hasText: name });
      await expect(live).toHaveCount(0);

      const section = archivedSectionOf(page, name);
      await expect(section).toHaveCount(1);
      const item = section.locator('[data-slot="archived-item"]', { hasText: name });
      await expect(item).toBeHidden();
      await section.locator('[data-slot="archived-toggle"]').click();
      await expect(item).toBeVisible();
      await item.getByRole("button", { name: `Restore ${name}`, exact: true }).click();
      await expect(page.getByText(`${name} restored`)).toBeVisible();
      await expect(live).toBeVisible();
      await expect(page.locator('[data-slot="archived-item"]', { hasText: name })).toHaveCount(0);

      // Archived again, the Owner deletes it: its own archive history is not use.
      await archiveIt();
      await page.reload();
      await hydrated(page);
      await archivedSectionOf(page, name).locator('[data-slot="archived-toggle"]').click();
      await archivedSectionOf(page, name)
        .getByRole("button", { name: `Delete ${name}`, exact: true })
        .click();
      const confirm = page.getByRole("alertdialog", { name: `Delete contact “${name}”?` });
      await confirm.getByRole("button", { name: `Delete ${name}`, exact: true }).click();
      await expect(page.getByText(`${name} deleted`)).toBeVisible();
      await expect(page.locator('[data-slot="archived-item"]', { hasText: name })).toHaveCount(0);
      expect(await serviceSelect(`client_contacts?id=eq.${contactId}&select=id`)).toHaveLength(0);
    } finally {
      await removeClientFixture(client);
    }
  });
});
