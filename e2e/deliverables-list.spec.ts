import type { Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  expectBackStack,
  expectNoHorizontalScroll,
  expectSettled,
  holdReads,
  hydrated,
  memberIdOf,
  ownSession,
  removeClientFixture,
  rpcAs,
  runInstalled,
  serviceInsert,
  serviceSelect,
  storageStateFor,
  USERS,
} from "./helpers";

/**
 * The project page's deliverables list after the owner's feedback (E+, ROADMAP 6b.11's owner note
 * of 2026-10-16): one stage group per line as a compact strip that opens in place to its chips (a
 * view control: no history), "Next: ‹stage›" on each deliverable, a quiet Mark done that is the
 * screen's one solid red only on the first deliverable with every stage ticked, checkboxes only in
 * Select mode (which hides the rows' own Mark done), aligned laptop columns, the phone card's 44 px
 * targets, and the installed back order at 375 and 430 px (ARCHITECTURE §14.2). Projects are made
 * the old way (`project_create`, plain stages: one untitled group, today's data) with groups added
 * to one deliverable; every name is neutral and made here.
 */

const admin = USERS.admin;
const owner = USERS.owner;
const nameOf = (info: TestInfo, what: string) => `DL ${what} (${info.project.name})`;

test.use({ storageState: storageStateFor("admin") });

/** An Active client run by the seeded Admin. */
async function workClient(name: string): Promise<string> {
  await removeClientFixture(name);
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  const row = await serviceInsert<{ id: string }>("clients", {
    org_id: org?.id,
    name,
    admin_id: await memberIdOf(admin.email),
  });
  await rpcAs(owner.email, owner.password, "client_activate", { client_id: row.id });
  return row.id;
}

const call = (fn: string, args: Record<string, unknown>) =>
  rpcAs(admin.email, admin.password, fn, args);

async function itemId(projectId: string, title: string): Promise<string> {
  const [row] = await serviceSelect<{ id: string }>(
    `project_items?project_id=eq.${projectId}&title=eq.${encodeURIComponent(title)}&select=id`,
  );
  return row?.id ?? "";
}

async function tick(id: string, names: string[]): Promise<void> {
  for (const name of names) {
    const [stage] = await serviceSelect<{ id: string }>(
      `project_item_stage_list?item_id=eq.${id}&name=eq.${encodeURIComponent(name)}&archived_at=is.null&select=id`,
    );
    await call("item_stage_tick", { stage_id: stage!.id, done: true });
  }
}

/**
 * "Grouped" carries the untitled "Stage 1" (ticked) plus "Edit" (Cut and Colour ticked, Export
 * next) and "Review"; "Ready A" and "Ready B" have every stage ticked; "Fresh" none; "Finished"
 * is done and "Dropped" closed.
 */
async function listProject(clientId: string): Promise<string> {
  const titles = ["Grouped", "Ready A", "Ready B", "Fresh", "Finished", "Dropped"];
  const projectId = await rpcAs<string>(admin.email, admin.password, "project_create", {
    client_id: clientId,
    name: "List work",
    recurrence: "monthly",
    stages: ["Stage 1"],
    items: titles,
  });
  const ids = Object.fromEntries(
    await Promise.all(titles.map(async (title) => [title, await itemId(projectId, title)])),
  ) as Record<string, string>;
  await call("item_stage_group_add", {
    item_id: ids.Grouped,
    label: "Edit",
    stages: ["Cut", "Colour", "Export"],
  });
  await call("item_stage_group_add", {
    item_id: ids.Grouped,
    label: "Review",
    stages: ["Revision 1"],
  });
  await tick(ids.Grouped!, ["Stage 1", "Cut", "Colour"]);
  await tick(ids["Ready A"]!, ["Stage 1"]);
  await tick(ids["Ready B"]!, ["Stage 1"]);
  await call("item_mark_done", { item_id: ids.Finished });
  await call("item_cancel", { item_id: ids.Dropped, reason: "Not needed" });
  return projectId;
}

const row = (page: Page, title: string) =>
  page.locator('[data-slot="item-row"]', { has: page.getByText(title, { exact: true }) });
const strips = (page: Page, title: string) =>
  row(page, title).locator('[data-slot="item-strip-toggle"]');
const markDone = (page: Page, title: string) =>
  row(page, title).locator('[data-slot="item-row-done"]');
const historyLength = (page: Page) => page.evaluate(() => window.history.length);

test("one strip per stage group opening in place, Next, and Mark done solid only when every stage is ticked", async ({
  page,
}, info) => {
  const client = nameOf(info, "strips");
  const clientId = await workClient(client);
  const projectId = await listProject(clientId);
  const here = new RegExp(`/projects/${projectId}$`);
  await page.goto(`/clients/${clientId}/projects/${projectId}`);
  await hydrated(page);

  // One line per group: the untitled one reads "Stages"; each strip its own n/m.
  await expect(strips(page, "Grouped")).toHaveText([
    "Stages 1/1 stages ticked",
    "Edit 2/3 stages ticked",
    "Review 0/1 stages ticked",
  ]);
  const bars = row(page, "Grouped").locator('[data-slot="item-strip-bar"]');
  expect(
    await bars.evaluateAll((nodes) =>
      nodes.map((node) => [node.dataset.done, node.dataset.next, node.dataset.total]),
    ),
  ).toEqual([
    ["1", "0", "1"],
    ["2", "1", "3"],
    ["0", "0", "1"],
  ]);
  const next = (title: string) => row(page, title).locator('[data-slot="item-next"]:visible');
  await expect(next("Grouped")).toHaveText("Next: Export");
  await expect(next("Ready A")).toHaveText("All stages ticked");
  await expect(next("Fresh")).toHaveText("Next: Stage 1");

  // Opening a strip shows that group's chips only, in place: no history entry, no address.
  const before = await historyLength(page);
  const edit = strips(page, "Grouped").nth(1);
  await edit.click();
  await expect(edit).toHaveAttribute("aria-expanded", "true");
  await expect(row(page, "Grouped").locator('[data-slot="stage-chip"]')).toHaveText([
    "Cut, ticked",
    "Colour, ticked",
    "Export, next",
  ]);
  expect(await historyLength(page)).toBe(before);
  await expect(page).toHaveURL(here);
  await expectNoHorizontalScroll(page);
  await edit.click();
  await expect(row(page, "Grouped").locator('[data-slot="stage-chip"]')).toHaveCount(0);

  // Mark done: quiet until every stage is ticked; the first ready one is the screen's one solid
  // red, the next ready one outlined.
  await expect(markDone(page, "Grouped")).toHaveAttribute("data-look", "quiet");
  await expect(markDone(page, "Grouped")).toHaveAttribute("data-variant", "ghost");
  await expect(markDone(page, "Fresh")).toHaveAttribute("data-look", "quiet");
  await expect(markDone(page, "Ready A")).toHaveAttribute("data-look", "solid");
  await expect(markDone(page, "Ready A")).toHaveAttribute("data-variant", "primary");
  await expect(markDone(page, "Ready B")).toHaveAttribute("data-look", "ready");
  await expect(markDone(page, "Ready B")).toHaveAttribute("data-variant", "secondary");
  await expect(page.locator('[data-variant="primary"]:visible')).toHaveCount(1);

  // Marked done (held for its Undo), the solid red moves to the next ready one; Undo moves it back.
  await markDone(page, "Ready A").click();
  await expect(row(page, "Ready A")).toHaveAttribute("data-held", "");
  await expect(markDone(page, "Ready B")).toHaveAttribute("data-look", "solid");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(markDone(page, "Ready A")).toHaveAttribute("data-look", "solid");
  await expect(markDone(page, "Ready B")).toHaveAttribute("data-look", "ready");

  // Checkboxes only in Select mode, which hides the rows' own Mark done (its bar does it).
  await expect(page.locator('[data-slot="item-row"] [role="checkbox"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await expect(page.locator('[data-slot="item-row"] [role="checkbox"]')).toHaveCount(4);
  await expect(page.locator('[data-slot="item-row-done"]')).toHaveCount(0);
  await expect(page.locator('[data-variant="primary"]:visible')).toHaveCount(0);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator('[data-slot="item-row"] [role="checkbox"]')).toHaveCount(0);
  await expect(markDone(page, "Ready A")).toHaveAttribute("data-look", "solid");

  // Done and closed deliverables show their state where Next sits; a done one's strip is full.
  await page.locator('[data-slot="finished-toggle"]').click();
  await expect(next("Finished")).toHaveText("Done");
  await expect(next("Dropped")).toHaveText("Closed");
  await expect(row(page, "Finished").locator('[data-slot="item-strip-bar"]')).toHaveAttribute(
    "data-done",
    "1",
  );
  await expect(row(page, "Finished").locator('[data-slot="item-row-done"]')).toHaveCount(0);
  await removeClientFixture(client);
});

test("laptop columns line up row to row; a phone's card keeps 44 px targets", async ({
  page,
}, info) => {
  const client = nameOf(info, "columns");
  const clientId = await workClient(client);
  const projectId = await listProject(clientId);
  await page.goto(`/clients/${clientId}/projects/${projectId}`);
  await hydrated(page);
  const phone = (page.viewportSize()?.width ?? 1280) < 768;
  await page.locator('[data-slot="finished-toggle"]').click();
  const rows = page.locator('[data-slot="item-row"]');
  await expect(rows).toHaveCount(6);
  await expectNoHorizontalScroll(page);

  if (!phone) {
    // Each column's left edge is the same in every row, the open list and the finished group's.
    const columns = await rows.evaluateAll((nodes) =>
      nodes.map((node) =>
        [
          '[data-slot="item-open"]',
          '[data-slot="item-strips"]',
          '[data-slot="item-next-cell"]',
          '[data-slot="item-planned-cell"]',
          '[data-slot="item-action"]',
        ].map((selector) => Math.round(node.querySelector(selector)!.getBoundingClientRect().left)),
      ),
    );
    for (const columnsOfRow of columns) expect(columnsOfRow).toEqual(columns[0]);
    // In order, left to right: title, progress, next, planned, action.
    const first = columns[0]!;
    expect([...first].sort((a, b) => a - b)).toEqual(first);
    // The strips' bars line up too.
    const barLefts = await page
      .locator('[data-slot="item-strip-bar"]')
      .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().left)));
    expect(new Set(barLefts).size).toBe(1);
  } else {
    // A card: every strip and Mark done is a 44 px target.
    for (const target of [
      ...(await page.locator('[data-slot="item-strip-toggle"]').all()),
      ...(await page.locator('[data-slot="item-row-done"]').all()),
    ]) {
      const box = await target.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    // Next sits under the title, the strips under both.
    const grouped = row(page, "Grouped");
    const title = await grouped.locator('[data-slot="item-open"]').boundingBox();
    const strip = await grouped.locator('[data-slot="item-strip-toggle"]').first().boundingBox();
    expect(strip!.y).toBeGreaterThanOrEqual(title!.y + title!.height - 1);
  }
  await removeClientFixture(client);
});

test("the loading screen traces the list: its heading, first row, first strip and a row's height", async ({
  page,
}, info) => {
  const client = nameOf(info, "skeleton");
  const clientId = await workClient(client);
  const projectId = await listProject(clientId);
  const tops = (selectors: Record<string, string>) =>
    page.evaluate((entries) => {
      const found: Record<string, number | null> = {};
      for (const [name, selector] of Object.entries(entries)) {
        const element = [...document.querySelectorAll<HTMLElement>(selector)].find(
          (candidate) =>
            candidate.getBoundingClientRect().height > 0 && candidate.checkVisibility(),
        );
        found[name] = element ? element.getBoundingClientRect().top + window.scrollY : null;
      }
      return found;
    }, selectors);
  const session = await ownSession(page, admin.email, admin.password);
  const held = await holdReads("/rest/v1/project_items", session);
  try {
    await page.goto(`/clients/${clientId}/projects/${projectId}`, { waitUntil: "commit" });
    const loading = page.locator('[data-slot="loading-project"]');
    await expect(loading).toBeVisible();
    await expect.poll(() => held.caught()).toBe(true);
    const skeleton = await tops({
      row: '[data-slot="loading-project"] ul > li',
      head: '[data-slot="loading-project"] > div[aria-hidden] > div:nth-child(2)',
      top: '[data-slot="loading-project"] > div[aria-hidden]',
      strip: '[data-slot="loading-project"] ul > li > span:nth-child(2) > span',
    });
    const skeletonRow = await page
      .locator('[data-slot="loading-project"] ul > li')
      .first()
      .evaluate((node) => node.getBoundingClientRect().height);
    held.release();
    await expect(loading).toHaveCount(0);
    await expectSettled(page);
    await hydrated(page);
    const settled = await tops({
      row: '[data-slot="cycle-items"] > [data-slot="item-row"]',
      head: 'section[aria-labelledby="cycle-items-title"]',
      top: '[data-slot="project-page"]',
      strip: '[data-slot="cycle-items"] [data-slot="item-strip-toggle"]',
    });
    // Measured from the content's top: the title bar above it is the shared header's (its own
    // trace is the back control's, PROGRESS Ideas), this unit's tracing is the list's.
    for (const name of ["head", "row", "strip"] as const) {
      expect(skeleton[name], `${name} in the skeleton`).not.toBeNull();
      expect(
        Math.abs(settled[name]! - settled.top! - (skeleton[name]! - skeleton.top!)),
        `${name} stays put`,
      ).toBeLessThanOrEqual(1);
    }
    // A one-strip row ("Ready A": planned and Next lines, one strip) is the skeleton row's height.
    const oneStrip = await row(page, "Ready A").evaluate(
      (node) => node.getBoundingClientRect().height,
    );
    expect(Math.abs(oneStrip - skeletonRow), "a row's height").toBeLessThanOrEqual(1);
  } finally {
    held.release();
    await removeClientFixture(client);
  }
});

test.describe("the strips, installed (ARCHITECTURE §14.2)", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name === "desktop", "the phone widths, 375 and 430");
  });

  test("opening a strip adds no history: one back leaves the page for the Projects tab", async ({
    page,
  }, info) => {
    const client = nameOf(info, "back");
    const clientId = await workClient(client);
    const projectId = await listProject(clientId);
    const tab = `/clients/${clientId}/projects`;
    await runInstalled(page);
    await page.goto(tab);
    await hydrated(page);
    await page.locator('[data-slot="project-row"]', { hasText: "List work" }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
    await hydrated(page);
    const before = await historyLength(page);

    // Two strips open and one closed again: still the same history.
    const grouped = strips(page, "Grouped");
    await grouped.nth(1).click();
    await grouped.nth(2).click();
    await grouped.nth(2).click();
    await expect(grouped.nth(1)).toHaveAttribute("aria-expanded", "true");
    expect(await historyLength(page)).toBe(before);

    // Back is not spent on the strip: it leaves the page.
    await expectBackStack(page, [{ url: new RegExp(`${tab}$`) }]);

    // Over Select mode, back closes Select mode first, then leaves (a strip open meanwhile).
    await page.locator('[data-slot="project-row"]', { hasText: "List work" }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
    await hydrated(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    const boxes = page.locator('[data-slot="item-row"] [role="checkbox"]');
    await expect(boxes.first()).toBeVisible();
    await strips(page, "Grouped").first().click();
    await expectBackStack(page, [
      { closes: boxes.first(), url: new RegExp(`/projects/${projectId}$`) },
      { url: new RegExp(`${tab}$`) },
    ]);
    await removeClientFixture(client);
  });
});
