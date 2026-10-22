import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  memberIdOf,
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
  row: (context: { orgId: string; ownerId: string }) => Promise<Record<string, unknown>>;
  /** The archive confirmation asks for a reason (a deliverable template's, invariant 9). */
  reason?: boolean;
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
    nameColumn: "name",
    row: async ({ orgId, ownerId }) => ({
      org_id: orgId,
      created_by: ownerId,
      stages: ["Shoot", "Edit"],
    }),
  },
  {
    kind: "a deliverable template",
    path: "/settings/templates",
    table: "deliverable_templates",
    nameColumn: "name",
    row: async ({ orgId, ownerId }) => ({ org_id: orgId, created_by: ownerId }),
    reason: true,
  },
  {
    kind: "a project template",
    path: "/settings/templates",
    table: "project_templates",
    nameColumn: "name",
    row: async ({ orgId, ownerId }) => ({
      org_id: orgId,
      created_by: ownerId,
      recurrence: "one_time",
    }),
  },
  {
    kind: "a task template",
    path: "/settings/templates",
    table: "task_templates",
    nameColumn: "name",
    row: async ({ orgId, ownerId }) => ({
      org_id: orgId,
      created_by: ownerId,
      task_type_id: await taskTypeId("Normal"),
    }),
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
      const row = await list.row({
        orgId: org!.id,
        ownerId: await memberIdOf(USERS.owner.email),
      });
      await serviceInsert(list.table, { ...row, [list.nameColumn]: name });
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
