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
 * screen's one solid commit only on the first deliverable with every stage ticked, checkboxes only in
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
/** The collapsed row's progress (V3): one bar and "n/m", a tap opens the checklist in place. */
const strips = (page: Page, title: string) =>
  row(page, title).locator('[data-slot="item-progress"]');
const markDone = (page: Page, title: string) =>
  row(page, title).locator('[data-slot="item-row-done"]');
const more = (page: Page, title: string) =>
  row(page, title).getByRole("button", { name: `More for ${title}` });
const sheetOf = (page: Page, title: string) =>
  page.locator('[data-slot="review-sheet"]').filter({ hasText: title });
/**
 * Clicks the row where `target` is drawn, through whatever covers it there (the row's stretched
 * open target, or in Select mode its checkbox's label): a real click at that spot of the row,
 * placed relative to the row so a sliding screen cannot move it.
 */
async function clickRowAt(page: Page, title: string, target: string): Promise<void> {
  const line = row(page, title);
  await expect(line).toBeVisible();
  const [rowBox, box] = await Promise.all([
    line.boundingBox(),
    line.locator(target).first().boundingBox(),
  ]);
  await line.click({
    position: {
      x: box!.x - rowBox!.x + box!.width / 2,
      y: box!.y - rowBox!.y + box!.height / 2,
    },
  });
}
const clickChevron = (page: Page, title: string) =>
  clickRowAt(page, title, '[data-slot="item-row-chevron"]');
async function stageDone(itemTitle: string, projectId: string, name: string): Promise<boolean> {
  const id = await itemId(projectId, itemTitle);
  const [stage] = await serviceSelect<{ done_at: string | null }>(
    `project_item_stage_list?item_id=eq.${id}&name=eq.${encodeURIComponent(name)}&archived_at=is.null&select=done_at`,
  );
  return stage?.done_at != null;
}
const historyLength = (page: Page) => page.evaluate(() => window.history.length);

test("a collapsed row: one bar and n/m, its checklist opening in place by group, Next, and Mark done solid only when every stage is ticked", async ({
  page,
}, info) => {
  const client = nameOf(info, "strips");
  const clientId = await workClient(client);
  const projectId = await listProject(clientId);
  const here = new RegExp(`/projects/${projectId}$`);
  await page.goto(`/clients/${clientId}/projects/${projectId}`);
  await hydrated(page);

  // V3 (fixes A, C): one bar over every stage, whatever the groups, with its "n/m".
  await expect(strips(page, "Grouped")).toHaveText("3/5 stages ticked");
  const bars = row(page, "Grouped").locator('[data-slot="item-progress-bar"]');
  expect(
    await bars.evaluateAll((nodes) =>
      nodes.map((node) => [node.dataset.done, node.dataset.next, node.dataset.total]),
    ),
  ).toEqual([["3", "1", "5"]]);
  const next = (title: string) => row(page, title).locator('[data-slot="item-next"]:visible');
  await expect(next("Grouped")).toHaveText("Next: Export");
  await expect(next("Ready A")).toHaveText("All stages ticked");
  await expect(next("Fresh")).toHaveText("Next: Stage 1");
  await expect(row(page, "Grouped").locator('[data-slot="stage-check"]')).toHaveCount(0);

  // Opening the row shows its checklist under each group's heading and count (fixes B, F), in
  // place: no history entry, no address.
  const before = await historyLength(page);
  const edit = strips(page, "Grouped");
  await edit.click();
  await expect(edit).toHaveAttribute("aria-expanded", "true");
  await expect(row(page, "Grouped").locator('[data-slot="item-stage-group-label"]')).toHaveText([
    /^Stages\s*1\/1$/,
    /^Edit\s*2\/3$/,
    /^Review\s*0\/1$/,
  ]);
  await expect(row(page, "Grouped").locator('[data-slot="stage-check"]')).toHaveText([
    "Stage 1, ticked",
    "Cut, ticked",
    "Colour, ticked",
    "Export, next",
    "Revision 1, to do",
  ]);
  expect(await historyLength(page)).toBe(before);
  await expect(page).toHaveURL(here);
  await expectNoHorizontalScroll(page);
  await edit.click();
  await expect(row(page, "Grouped").locator('[data-slot="stage-check"]')).toHaveCount(0);

  // Mark done: in the row's ⋯ until every stage is ticked (unit U); then on the row, the first
  // ready one the screen's one solid commit, the next ready one outlined.
  await expect(markDone(page, "Grouped")).toHaveCount(0);
  await expect(markDone(page, "Fresh")).toHaveCount(0);
  await expect(more(page, "Grouped")).toBeVisible();
  await expect(more(page, "Ready A")).toHaveCount(0);
  await expect(markDone(page, "Ready A")).toHaveAttribute("data-look", "solid");
  await expect(markDone(page, "Ready A")).toHaveAttribute("data-variant", "primary");
  await expect(markDone(page, "Ready B")).toHaveAttribute("data-look", "ready");
  await expect(markDone(page, "Ready B")).toHaveAttribute("data-variant", "secondary");
  await expect(page.locator('[data-variant="primary"]:visible')).toHaveCount(1);

  // Marked done (held for its Undo), the solid commit moves to the next ready one; Undo moves it back.
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
  await expect(page.locator('[data-slot="item-row-more"]')).toHaveCount(0);
  await expect(page.locator('[data-variant="primary"]:visible')).toHaveCount(0);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator('[data-slot="item-row"] [role="checkbox"]')).toHaveCount(0);
  await expect(markDone(page, "Ready A")).toHaveAttribute("data-look", "solid");

  // Done and closed deliverables show their state where Next sits; a done one's strip is full.
  await page.locator('[data-slot="finished-toggle"]').click();
  await expect(next("Finished")).toHaveText("Done");
  await expect(next("Dropped")).toHaveText("Closed");
  await expect(row(page, "Finished").locator('[data-slot="item-progress-bar"]')).toHaveAttribute(
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
          '[data-slot="item-progress"]',
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
    // The bars line up too.
    const barLefts = await page
      .locator('[data-slot="item-progress-bar"]')
      .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().left)));
    expect(new Set(barLefts).size).toBe(1);
  } else {
    // A card: every bar and Mark done is a 44 px target.
    for (const target of [
      ...(await page.locator('button[data-slot="item-progress"]').all()),
      ...(await page.locator('[data-slot="item-row-done"]').all()),
      ...(await page.locator('[data-slot="item-row-more"]').all()),
      ...(await page.locator('[data-slot="item-next-line"]').all()),
    ]) {
      const box = await target.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    // Next sits under the title, the bar under both.
    const grouped = row(page, "Grouped");
    const title = await grouped.locator('[data-slot="item-open"]').boundingBox();
    const strip = await grouped.locator('[data-slot="item-progress"]').first().boundingBox();
    expect(strip!.y).toBeGreaterThanOrEqual(title!.y + title!.height - 1);
  }
  await removeClientFixture(client);
});

test("the loading screen traces the list: its heading, first row, its bar and a row's height", async ({
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
      strip: '[data-slot="loading-project"] ul > li > span:nth-child(2)',
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
      strip: '[data-slot="cycle-items"] [data-slot="item-progress"]',
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
    // A collapsed row ("Ready A": planned and Next lines, its bar) is the skeleton row's height.
    const oneStrip = await row(page, "Ready A").evaluate(
      (node) => node.getBoundingClientRect().height,
    );
    expect(Math.abs(oneStrip - skeletonRow), "a row's height").toBeLessThanOrEqual(1);
  } finally {
    held.release();
    await removeClientFixture(client);
  }
});

test("the whole row opens the deliverable: a click anywhere, Enter or Space; in Select mode a tap selects", async ({
  page,
}, info) => {
  const client = nameOf(info, "open");
  const clientId = await workClient(client);
  const projectId = await rpcAs<string>(admin.email, admin.password, "project_create", {
    client_id: clientId,
    name: "Open work",
    recurrence: "monthly",
    stages: ["Stage 1"],
    items: ["Reel A", "Reel B"],
  });
  await page.goto(`/clients/${clientId}/projects/${projectId}`);
  await hydrated(page);
  const sheet = sheetOf(page, "Reel A");

  // Anywhere on the row that is not one of its controls: here its "›" at the right edge.
  await clickChevron(page, "Reel A");
  await expect(sheet).toBeVisible();
  await page.goBack();
  await expect(sheet).toBeHidden();

  // The keyboard: the row is one button, Enter and Space open it.
  await row(page, "Reel A").locator('[data-slot="item-open"]').focus();
  await page.keyboard.press("Enter");
  await expect(sheet).toBeVisible();
  await page.goBack();
  await expect(sheet).toBeHidden();
  await row(page, "Reel A").locator('[data-slot="item-open"]').focus();
  await page.keyboard.press("Space");
  await expect(sheet).toBeVisible();
  await page.goBack();
  await expect(sheet).toBeHidden();

  // The row's own controls keep their taps: the bar opens the checklist in place, no sheet.
  await strips(page, "Reel A").first().click();
  await expect(strips(page, "Reel A").first()).toHaveAttribute("aria-expanded", "true");
  await expect(sheet).toBeHidden();

  // Select mode: a tap on the row ticks its box instead, and no "›" says it opens.
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await expect(page.locator('[data-slot="select-hint"]')).toHaveText(
    "Select deliverables, then choose an action.",
  );
  const box = row(page, "Reel B").getByRole("checkbox", { name: "Select Reel B" });
  await expect(row(page, "Reel B").locator('[data-slot="item-row-chevron"]')).toHaveCount(0);
  await clickRowAt(page, "Reel B", '[data-slot="item-open"]');
  await expect(box).toHaveAttribute("aria-checked", "true");
  await expect(sheetOf(page, "Reel B")).toBeHidden();
  await expect(page.locator('[data-slot="select-hint"]')).toHaveCount(0);
  // The list reserves the bar's height while selecting: scrolled to the end, the last row sits
  // clear of the floating bar, and a second tap on it clears it again.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const bar = page.locator('[data-slot="bulk-bar"]');
  await expect(bar).toBeVisible();
  await expect
    .poll(async () => {
      const [last, over] = await Promise.all([
        row(page, "Reel B").boundingBox(),
        bar.boundingBox(),
      ]);
      return last!.y + last!.height <= over!.y;
    })
    .toBe(true);
  await clickRowAt(page, "Reel B", '[data-slot="item-open"]');
  await expect(box).toHaveAttribute("aria-checked", "false");
  await expect(bar).toHaveCount(0);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await removeClientFixture(client);
});

test("with the notifications band showing, the Select bar sits above it and the last row still clears the bar", async ({
  page,
}, info) => {
  const client = nameOf(info, "band");
  const clientId = await workClient(client);
  const projectId = await rpcAs<string>(admin.email, admin.password, "project_create", {
    client_id: clientId,
    name: "Band work",
    recurrence: "monthly",
    stages: ["Stage 1"],
    items: ["Clip A", "Clip B"],
  });
  await page.goto(`/clients/${clientId}/projects/${projectId}`);
  await hydrated(page);
  // The seeded Admin has no device that has received a push, so the band shows ("off").
  const band = page.locator('[data-slot="push-banner"]');
  await expect(band).toBeVisible();

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await clickRowAt(page, "Clip B", '[data-slot="item-open"]');
  const bar = page.locator('[data-slot="bulk-bar"]');
  await expect(bar).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect
    .poll(async () => {
      const [over, under, last] = await Promise.all([
        bar.boundingBox(),
        band.boundingBox(),
        row(page, "Clip B").boundingBox(),
      ]);
      // The bar's box ends above the band's (no overlap), and the last row ends above the bar.
      return over!.y + over!.height <= under!.y && last!.y + last!.height <= over!.y;
    })
    .toBe(true);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await removeClientFixture(client);
});

test("a checklist line ticks in one tap with Undo; Next ticks its stage; Mark done shows once all are ticked", async ({
  page,
}, info) => {
  const client = nameOf(info, "ticks");
  const clientId = await workClient(client);
  const projectId = await listProject(clientId);
  await page.goto(`/clients/${clientId}/projects/${projectId}`);
  await hydrated(page);

  // A checklist line ticks its stage through the same tick as the sheet, says so, offers Undo.
  const edit = strips(page, "Grouped");
  await edit.click();
  const chip = (name: string) =>
    row(page, "Grouped")
      .locator('[data-slot="stage-check"]')
      .and(page.getByRole("button", { name }));
  const exportChip = chip("Tick Export");
  await expect(exportChip).toHaveAttribute("data-check", "next");
  await exportChip.click();
  await expect(page.getByText("Ticked Edit · Export on Grouped", { exact: true })).toBeVisible();
  const ticked = chip("Untick Export");
  await expect(ticked).toHaveAttribute("data-check", "ticked");
  await expect.poll(() => stageDone("Grouped", projectId, "Export")).toBe(true);
  await expect(row(page, "Grouped").locator('[data-slot="item-next"]:visible')).toHaveText(
    "Next: Revision 1",
  );
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Unticked Edit · Export on Grouped", { exact: true })).toBeVisible();
  await expect(exportChip).toHaveAttribute("data-check", "next");
  await expect.poll(() => stageDone("Grouped", projectId, "Export")).toBe(false);

  // Mark done waits in the row's ⋯ (with Open) while a stage is left.
  await expect(markDone(page, "Fresh")).toHaveCount(0);
  await more(page, "Fresh").click();
  await expect(page.getByRole("menuitem", { name: "Open" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Mark done" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "Mark done" })).toBeHidden();

  // "Next: Stage 1" is a one-tap tick ("Tick Stage 1"); with every stage ticked Mark done comes
  // onto the row (outlined: "Ready A" above it keeps the one solid commit).
  const next = row(page, "Fresh").locator('[data-slot="item-next"]:visible');
  await expect(next).toHaveText("Next: Stage 1");
  await expect(next).toHaveAttribute("aria-label", "Tick Stage 1");
  await next.click();
  await expect(page.getByText("Ticked Stage 1 on Fresh", { exact: true })).toBeVisible();
  await expect.poll(() => stageDone("Fresh", projectId, "Stage 1")).toBe(true);
  await expect(markDone(page, "Fresh")).toHaveAttribute("data-look", "ready");
  await expect(more(page, "Fresh")).toHaveCount(0);
  await expect(page.locator('[data-variant="primary"]:visible')).toHaveCount(1);

  // A done deliverable's checklist only reads.
  await page.locator('[data-slot="finished-toggle"]').click();
  await strips(page, "Finished").first().click();
  await expect(row(page, "Finished").locator('[data-slot="stage-check"]')).toHaveCount(1);
  await expect(row(page, "Finished").locator('button[data-slot="stage-check"]')).toHaveCount(0);
  await removeClientFixture(client);
});

test("the deliverable's sheet: the list's group headings, neutral ticks, Edit details, Move up and down in ⋯", async ({
  page,
}, info) => {
  const client = nameOf(info, "sheet");
  const clientId = await workClient(client);
  const projectId = await listProject(clientId);
  await page.goto(`/clients/${clientId}/projects/${projectId}`);
  await hydrated(page);
  await row(page, "Grouped").locator('[data-slot="item-open"]').click();
  const sheet = sheetOf(page, "Grouped");
  await expect(sheet.locator('[data-slot="item-stage-group-heading"]')).toHaveText([
    "Stages1/1 stages ticked",
    "Edit2/3 stages ticked",
    "Review0/1 stages ticked",
  ]);
  // A ticked box is neutral, never red (red is urgent or destructive only, ADR-0015).
  const red = await sheet.evaluate((node) => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--danger)";
    node.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  });
  const boxes = await sheet
    .locator('[data-slot="item-stage-tick"][aria-checked="true"] [data-slot="item-stage-box"]')
    .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
  expect(boxes).toHaveLength(3);
  for (const colour of boxes) expect(colour).not.toBe(red);

  // A tick in the sheet says what happened; its box is its undo (the sheet covers the toasts).
  const exportBox = sheet.getByRole("checkbox", { name: "Export" });
  await exportBox.click();
  await expect(page.getByText("Ticked Edit · Export on Grouped", { exact: true })).toBeVisible();
  await expect(exportBox).toHaveAttribute("aria-checked", "true");
  await exportBox.click();
  await expect(page.getByText("Unticked Edit · Export on Grouped", { exact: true })).toBeVisible();
  await expect(exportBox).toHaveAttribute("aria-checked", "false");

  await expect(sheet.getByRole("button", { name: "Edit details", exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Move up" })).toHaveCount(0);
  await sheet.getByRole("button", { name: "More for Grouped" }).click();
  // "Grouped" is first in the list: it cannot move up.
  await expect(page.getByRole("menuitem", { name: "Move up" })).toBeDisabled();
  await page.getByRole("menuitem", { name: "Move down" }).click();
  await expect(page.getByText("Moved Grouped down", { exact: true })).toBeVisible();
  await removeClientFixture(client);
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

    // A tap on the card opens the deliverable's sheet (the same layer as before): back closes it,
    // then leaves. The row's ⋯ is a menu: back closes it first.
    await page.locator('[data-slot="project-row"]', { hasText: "List work" }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
    await hydrated(page);
    await clickChevron(page, "Fresh");
    const sheet = sheetOf(page, "Fresh");
    await expect(sheet).toBeVisible();
    await page.goBack();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
    await more(page, "Fresh").click();
    const menuItem = page.getByRole("menuitem", { name: "Mark done" });
    await expect(menuItem).toBeVisible();
    await expectBackStack(page, [
      { closes: menuItem, url: new RegExp(`/projects/${projectId}$`) },
      { url: new RegExp(`${tab}$`) },
    ]);
    await removeClientFixture(client);
  });
});
