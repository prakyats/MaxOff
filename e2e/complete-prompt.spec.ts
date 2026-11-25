import type { Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  answerStartPrompt,
  expectNoHorizontalScroll,
  expectSettled,
  hydrated,
  memberIdOf,
  removeClientFixture,
  rpcAs,
  serviceInsert,
  serviceSelect,
  storageStateFor,
  USERS,
} from "./helpers";
import { addISTDays, todayIST } from "../src/core/time";

/**
 * A one-time project's last deliverable (v2.1 "Money in", kickoff 9 R1; WORKFLOWS §6): on the
 * project page, Mark done on the last open deliverable asks whoever may also complete the project
 * (the Owner, the client's Admin): **Mark done and complete project** (one transition, at once)
 * or **Mark done only** (as before, with its 6-second Undo). Not the first deliverable, never a
 * repeating project, never the bulk "Mark N done" or Today, which only mark. **Nothing is missed
 * then:** the project reads "Ready to complete" on its page and in the client's project list, and
 * an "All deliverables done" toast offers "Complete project". The client's Admin sees no amount,
 * rupee sign or billing word anywhere in it (invariant 2).
 *
 * Every client is named for its test and Playwright project and removed first
 * (`removeClientFixture`), so the spec re-runs on a used database.
 */

const owner = USERS.owner;
const admin = USERS.admin;
const nameOf = (info: TestInfo, what: string) => `Prompt ${what} (${info.project.name})`;

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

/** A project made by the client's Admin through `project_create`: one-time unless said. */
async function makeProject(
  clientId: string,
  name: string,
  items: string[],
  recurrence: "one_time" | "monthly" = "one_time",
  stages: string[] = [],
): Promise<string> {
  return rpcAs<string>(admin.email, admin.password, "project_create", {
    client_id: clientId,
    name,
    recurrence,
    stages,
    items,
    ...(recurrence === "one_time" ? { delivery_date: addISTDays(todayIST(), 10) } : {}),
  });
}

async function itemId(projectId: string, title: string): Promise<string> {
  const [row] = await serviceSelect<{ id: string }>(
    `project_items?project_id=eq.${projectId}&title=eq.${encodeURIComponent(title)}&select=id`,
  );
  expect(row, `the deliverable ${title}`).toBeTruthy();
  return row!.id;
}

async function itemStates(projectId: string): Promise<string[]> {
  const rows = await serviceSelect<{ state: string }>(
    `project_items?project_id=eq.${projectId}&select=state&order=title`,
  );
  return rows.map((row) => row.state);
}

async function projectState(projectId: string): Promise<string | undefined> {
  const [row] = await serviceSelect<{ state: string }>(`projects?id=eq.${projectId}&select=state`);
  return row?.state;
}

const itemRow = (page: Page, title: string) =>
  page.locator('[data-slot="item-row"]', { hasText: title });
const markDone = (page: Page, title: string) =>
  itemRow(page, title).getByRole("button", { name: "Mark done", exact: true });
const prompt = (page: Page) => page.getByRole("dialog", { name: "Complete the project too?" });
const progress = (page: Page) => page.locator('[data-slot="cycle-meter-line"]');
const readOnly = (page: Page) => page.locator('[data-slot="project-read-only"]');
/** The project's state chip: the header's from md, the glance line's on a phone. */
const stateChip = (page: Page, label: string) =>
  page.locator("[data-status]", { hasText: label }).filter({ visible: true });

/**
 * The project's row reads "Ready to complete" on the client's Overview (its active projects) and
 * on its Projects tab, as drawn.
 */
async function expectReadyRow(page: Page, clientId: string, project: string): Promise<void> {
  for (const path of [`/clients/${clientId}`, `/clients/${clientId}/projects`]) {
    await page.goto(path);
    await hydrated(page);
    const row = page.locator('[data-slot="project-row"]', { hasText: project });
    await expect(row.locator('[data-status="ready"]'), `${path}: the row's chip`).toHaveText(
      "Ready to complete",
    );
    await expectNoHorizontalScroll(page);
  }
}

/** Sends what waits for its Undo now: the app going to the background flushes it. */
async function flushSends(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

async function openProject(page: Page, path: string, role: "owner" | "admin"): Promise<void> {
  await page.goto(path);
  if (role === "admin") await answerStartPrompt(page);
  await hydrated(page);
  await expectSettled(page);
}

test.describe("the Owner", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("the first deliverable is only marked; the last one asks, and completes the project", async ({
    page,
  }, info) => {
    const client = nameOf(info, "owner completes");
    const clientId = await workClient(client);
    const projectId = await makeProject(clientId, "Launch film", ["Cut 1", "Cut 2"]);
    await openProject(page, `/clients/${clientId}/projects/${projectId}`, "owner");

    // Not the last one: marked at once, with its Undo, and no question.
    await markDone(page, "Cut 1").click();
    await expect(page.getByText("Marked Cut 1 done")).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);
    await flushSends(page);
    await expect(progress(page)).toHaveText("1 of 2 deliverables done");
    expect(await projectState(projectId)).not.toBe("completed");

    // The last one asks first; nothing is marked while it asks.
    await markDone(page, "Cut 2").click();
    const ask = prompt(page);
    await expect(ask).toBeVisible();
    await expect(ask).toContainText("Cut 2 is the last open deliverable of Launch film.");
    await expect(ask).toContainText("A completed project becomes read-only.");
    await expectNoHorizontalScroll(page);
    expect(await itemStates(projectId)).toEqual(["approved", "open"]);
    // One solid commit, the Forest green one; the other two are quiet.
    const heading = await ask
      .getByRole("heading", { name: "Complete the project too?" })
      .boundingBox();
    expect(heading?.x ?? -1, "the title is not cut at the sheet's edge").toBeGreaterThan(
      (await ask.boundingBox())?.x ?? 0,
    );
    const complete = ask.getByRole("button", { name: "Mark done and complete project" });
    await expect(complete).toHaveAttribute("data-variant", "approve");
    await expect(ask.getByRole("button", { name: "Mark done only" })).toHaveAttribute(
      "data-variant",
      "secondary",
    );
    const frame = await ask.boundingBox();
    for (const button of await ask.getByRole("button").all()) {
      const box = await button.boundingBox();
      // Every button and the title sit inside the sheet at every width (nothing cut at its edge).
      expect(box?.x ?? -1, "a button starts inside the sheet").toBeGreaterThanOrEqual(
        frame?.x ?? 0,
      );
      expect((box?.x ?? 0) + (box?.width ?? 0), "and ends inside it").toBeLessThanOrEqual(
        (frame?.x ?? 0) + (frame?.width ?? 0),
      );
      if (info.project.name !== "desktop") {
        expect(box?.height ?? 0, "a 44 px target on a phone").toBeGreaterThanOrEqual(44);
      }
    }
    await complete.click();
    await expect(ask).toBeHidden();
    await expect(page.getByText("Project completed")).toBeVisible();
    await expect(readOnly(page)).toContainText("Completed");
    expect(await projectState(projectId)).toBe("completed");
    expect(await itemStates(projectId)).toEqual(["approved", "approved"]);
    await removeClientFixture(client);
  });

  test("from the deliverable's sheet the same question appears", async ({ page }, info) => {
    const client = nameOf(info, "owner sheet");
    const clientId = await workClient(client);
    const projectId = await makeProject(clientId, "Sheet film", ["Final cut"]);
    await openProject(page, `/clients/${clientId}/projects/${projectId}`, "owner");

    await itemRow(page, "Final cut").locator('[data-slot="item-open"]').click();
    const sheet = page.locator('[data-slot="review-sheet"]');
    await sheet.getByRole("button", { name: "Mark done", exact: true }).click();
    await expect(sheet).toBeHidden();
    const ask = prompt(page);
    await expect(ask).toBeVisible();
    // Cancel changes nothing.
    await ask.getByRole("button", { name: "Cancel" }).click();
    await expect(ask).toBeHidden();
    expect(await itemStates(projectId)).toEqual(["open"]);
    await expect(itemRow(page, "Final cut")).not.toHaveAttribute("data-held", "");

    await itemRow(page, "Final cut").locator('[data-slot="item-open"]').click();
    await sheet.getByRole("button", { name: "Mark done", exact: true }).click();
    await prompt(page).getByRole("button", { name: "Mark done and complete project" }).click();
    await expect(readOnly(page)).toContainText("Completed");
    expect(await projectState(projectId)).toBe("completed");
    expect(await itemStates(projectId)).toEqual(["approved"]);
    await removeClientFixture(client);
  });

  test("the row's ⋯ Mark done…, with a stage left, asks about the stage first and then about the project", async ({
    page,
  }, info) => {
    const client = nameOf(info, "owner menu");
    const clientId = await workClient(client);
    const projectId = await makeProject(clientId, "Menu film", ["Final cut"], "one_time", ["Edit"]);
    await openProject(page, `/clients/${clientId}/projects/${projectId}`, "owner");

    // A stage is left: Mark done waits in the row's ⋯ and names what is unticked.
    await expect(markDone(page, "Final cut")).toHaveCount(0);
    await itemRow(page, "Final cut").getByRole("button", { name: "More for Final cut" }).click();
    await page.getByRole("menuitem", { name: "Mark done…" }).click();
    const early = page.getByRole("alertdialog", { name: "Mark Final cut done?" });
    await expect(early).toContainText("1 stage isn't ticked.");
    await early.getByRole("button", { name: "Mark done", exact: true }).click();
    // That confirmation gives way to the project's question; nothing is marked yet.
    const ask = prompt(page);
    await expect(ask).toBeVisible();
    await expect(early).toBeHidden();
    expect(await itemStates(projectId)).toEqual(["open"]);
    // Back closes the question alone (the hand-off left one layer, not two).
    await page.goBack();
    await expect(ask).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
    expect(await itemStates(projectId)).toEqual(["open"]);

    await itemRow(page, "Final cut").getByRole("button", { name: "More for Final cut" }).click();
    await page.getByRole("menuitem", { name: "Mark done…" }).click();
    await early.getByRole("button", { name: "Mark done", exact: true }).click();
    await prompt(page).getByRole("button", { name: "Mark done and complete project" }).click();
    await expect(readOnly(page)).toContainText("Completed");
    expect(await projectState(projectId)).toBe("completed");
    expect(await itemStates(projectId)).toEqual(["approved"]);
    await removeClientFixture(client);
  });

  test("Mark done only as the Owner: its Undo, then Ready to complete on the page, the Overview and the Projects tab", async ({
    page,
  }, info) => {
    const client = nameOf(info, "owner only");
    const clientId = await workClient(client);
    const projectId = await makeProject(clientId, "Owner film", ["Final cut"]);
    await openProject(page, `/clients/${clientId}/projects/${projectId}`, "owner");

    await markDone(page, "Final cut").click();
    await prompt(page).getByRole("button", { name: "Mark done only" }).click();
    await expect(itemRow(page, "Final cut")).toHaveAttribute("data-held", "");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(itemRow(page, "Final cut")).not.toHaveAttribute("data-held", "");
    expect(await itemStates(projectId)).toEqual(["open"]);

    await markDone(page, "Final cut").click();
    await prompt(page).getByRole("button", { name: "Mark done only" }).click();
    await flushSends(page);
    await expect.poll(() => itemStates(projectId)).toEqual(["approved"]);
    expect(await projectState(projectId)).not.toBe("completed");
    await expect(
      page.locator("[data-sonner-toast]", { hasText: "All deliverables done" }),
    ).toContainText("Owner film is ready to complete.");
    await expect(stateChip(page, "Ready to complete")).toBeVisible();
    await expectReadyRow(page, clientId, "Owner film");
    await removeClientFixture(client);
  });

  test("a repeating project's last deliverable is only marked", async ({ page }, info) => {
    const client = nameOf(info, "retainer");
    const clientId = await workClient(client);
    const projectId = await makeProject(clientId, "Monthly reels", ["Reel 1"], "monthly");
    await openProject(page, `/clients/${clientId}/projects/${projectId}`, "owner");

    await markDone(page, "Reel 1").click();
    await expect(page.getByText("Marked Reel 1 done")).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);
    await flushSends(page);
    await expect.poll(() => itemStates(projectId)).toEqual(["approved"]);
    // No "All deliverables done" for a repeating project, and it is not completed.
    await expect(progress(page)).toHaveText("1 of 1 deliverable done");
    await expect(page.getByText("All deliverables done")).toHaveCount(0);
    expect(await projectState(projectId)).not.toBe("completed");
    await removeClientFixture(client);
  });

  test("Mark N done on the last ones only marks: Ready to complete on the page and the list, and the toast completes", async ({
    page,
  }, info) => {
    const client = nameOf(info, "owner bulk");
    const clientId = await workClient(client);
    const projectId = await makeProject(clientId, "Bulk film", ["Cut 1", "Cut 2"]);
    const path = `/clients/${clientId}/projects/${projectId}`;
    await openProject(page, path, "owner");

    await page.getByRole("button", { name: "Select", exact: true }).click();
    await itemRow(page, "Cut 1").getByRole("checkbox").click();
    await itemRow(page, "Cut 2").getByRole("checkbox").click();
    await page.getByRole("button", { name: "Mark 2 done", exact: true }).click();
    const confirm = page.getByRole("alertdialog", { name: "Mark 2 deliverables done?" });
    await confirm.getByRole("button", { name: "Mark 2 deliverables done" }).click();
    await expect(confirm).toBeHidden();
    // Only marked: no question, the project is not completed, and it says so.
    await expect(prompt(page)).toHaveCount(0);
    expect(await itemStates(projectId)).toEqual(["approved", "approved"]);
    expect(await projectState(projectId)).not.toBe("completed");
    await expect(stateChip(page, "Ready to complete")).toBeVisible();
    const toast = page.locator("[data-sonner-toast]", { hasText: "All deliverables done" });
    await expect(toast).toContainText("Bulk film is ready to complete.");

    // The client's project list says it too.
    const list = await page.request.get(`/clients/${clientId}/projects`);
    expect(await list.text()).toContain("Ready to complete");

    // "Complete project" on the toast opens the same confirmation as the project's ⋯.
    await toast.getByRole("button", { name: "Complete project" }).click();
    const complete = page.getByRole("alertdialog", { name: "Complete Bulk film?" });
    await expect(complete).toContainText("It becomes read-only. You can reopen it later.");
    await complete.getByRole("button", { name: "Complete project" }).click();
    await expect(readOnly(page)).toContainText("Completed");
    expect(await projectState(projectId)).toBe("completed");
    await removeClientFixture(client);
  });
});

test.describe("the client's Admin", () => {
  test.use({ storageState: storageStateFor("admin") });

  test("Mark done only: its Undo as before, then Ready to complete, and Complete from the menu", async ({
    page,
  }, info) => {
    const client = nameOf(info, "admin only");
    const clientId = await workClient(client);
    const projectId = await makeProject(clientId, "Brand film", ["Cut 1", "Cut 2"]);
    const first = await itemId(projectId, "Cut 1");
    await rpcAs(admin.email, admin.password, "item_mark_done", { item_id: first });
    const path = `/clients/${clientId}/projects/${projectId}`;
    await openProject(page, path, "admin");

    // Mark done only: the usual held row and Undo; Undo sends nothing.
    await markDone(page, "Cut 2").click();
    await prompt(page).getByRole("button", { name: "Mark done only" }).click();
    await expect(prompt(page)).toBeHidden();
    await expect(itemRow(page, "Cut 2")).toHaveAttribute("data-held", "");
    await expect(page.getByText("Marked Cut 2 done")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(itemRow(page, "Cut 2")).not.toHaveAttribute("data-held", "");
    expect(await itemStates(projectId)).toEqual(["approved", "open"]);

    // Kept this time: sent, the deliverable is done, the project is not completed.
    await markDone(page, "Cut 2").click();
    await prompt(page).getByRole("button", { name: "Mark done only" }).click();
    await flushSends(page);
    await expect.poll(() => itemStates(projectId)).toEqual(["approved", "approved"]);
    expect(await projectState(projectId)).not.toBe("completed");

    // Nothing is missed: the toast, the page's chip and the client's project list.
    const toast = page.locator("[data-sonner-toast]", { hasText: "All deliverables done" });
    await expect(toast).toContainText("Brand film is ready to complete.");
    await expect(toast.getByRole("button", { name: "Complete project" })).toBeVisible();
    await expect(stateChip(page, "Ready to complete")).toBeVisible();
    const list = await (await page.request.get(`/clients/${clientId}/projects`)).text();
    expect(list).toContain("Ready to complete");
    expect(list.includes("₹"), "no rupee sign in the Admin's project list").toBe(false);

    // The Overview's active-project row and the Projects tab's, as drawn.
    await expectReadyRow(page, clientId, "Brand film");
    await page.goto(path);
    await hydrated(page);

    // Complete from the project's ⋯ still works.
    await page.getByRole("button", { name: "Actions for Brand film" }).click();
    await page.getByRole("menuitem", { name: "Complete project" }).click();
    const complete = page.getByRole("alertdialog", { name: "Complete Brand film?" });
    await complete.getByRole("button", { name: "Complete project" }).click();
    await expect(readOnly(page)).toContainText("Completed");
    expect(await projectState(projectId)).toBe("completed");
    await removeClientFixture(client);
  });

  test("the question holds no amount, rupee sign or billing word; a deliverable added meanwhile refuses it and nothing is marked", async ({
    page,
  }, info) => {
    const client = nameOf(info, "admin sealed");
    const clientId = await workClient(client);
    const projectId = await makeProject(clientId, "Sealed film", ["Only cut"]);
    // The Owner prices it, so there is an amount to leak.
    await rpcAs(owner.email, owner.password, "billing_set_project", {
      project_id: projectId,
      amount: 43210,
      set_amount: true,
      category: null,
    });
    const read = await rpcAs<{ billing: { fixed_amount: number | null } }>(
      owner.email,
      owner.password,
      "project_billing_read",
      { project_id: projectId },
    );
    expect(read.billing.fixed_amount, "not vacuous: the Owner's read holds the amount").toBe(43210);
    const path = `/clients/${clientId}/projects/${projectId}`;
    await openProject(page, path, "admin");

    await markDone(page, "Only cut").click();
    const ask = prompt(page);
    await expect(ask).toBeVisible();
    const html = await (await page.request.get(path)).text();
    const flight = await (await page.request.get(path, { headers: { RSC: "1" } })).text();
    for (const [what, body] of [
      ["the question", await ask.innerHTML()],
      ["the page as drawn", await page.content()],
      ["the HTML", html],
      ["the router's payload", flight],
    ] as const) {
      expect(body.includes("₹"), `${what}: no rupee sign`).toBe(false);
      expect(/(?<![\w-])43,?210(?![\w-])/.test(body), `${what}: no amount`).toBe(false);
      expect(
        /No amount set|Not priced|Amount per month|Advances|Potential|Achieved/.test(body),
        `${what}: no billing word`,
      ).toBe(false);
      expect(body.includes("project-billing"), `${what}: no Billing section`).toBe(false);
    }
    // The question's own words, in full: nothing about money in any form.
    expect(await ask.innerText()).not.toMatch(
      /billing|amount|advance|revenue|price|paid|pay|invoice|rupee|money|\d/i,
    );

    // Someone adds a deliverable while the question is open: completing is refused in words,
    // and the last one is not marked either (one transaction).
    const [cycle] = await serviceSelect<{ id: string }>(
      `project_cycles?project_id=eq.${projectId}&select=id&limit=1`,
    );
    await rpcAs(admin.email, admin.password, "item_add", {
      cycle_id: cycle?.id,
      title: "Late cut",
    });
    await ask.getByRole("button", { name: "Mark done and complete project" }).click();
    await expect(ask.locator('[data-slot="form-alert"]')).toContainText(
      "1 item is still open or waiting for approval",
    );
    expect(await itemStates(projectId)).toEqual(["open", "open"]);
    expect(await projectState(projectId)).not.toBe("completed");
    // The list behind is read again: the new deliverable shows once the question is closed.
    await ask.getByRole("button", { name: "Cancel" }).click();
    await expect(itemRow(page, "Late cut")).toBeVisible();
    // No longer the last one: Mark done is plain again.
    await markDone(page, "Only cut").click();
    await expect(page.getByText("Marked Only cut done")).toBeVisible();
    await expect(prompt(page)).toBeHidden();
    await page.getByRole("button", { name: "Undo" }).click();
    await removeClientFixture(client);
  });

  test("Today only marks: All deliverables done, and Complete project opens the project", async ({
    page,
  }, info) => {
    const client = nameOf(info, "admin today");
    const clientId = await workClient(client);
    const title = nameOf(info, "today cut");
    const projectId = await makeProject(clientId, "Today film", [title]);
    await rpcAs(admin.email, admin.password, "item_update", {
      item_id: await itemId(projectId, title),
      changes: { planned_date: todayIST() },
    });
    await page.goto("/today");
    await answerStartPrompt(page);
    await hydrated(page);
    await expect(page.locator('[data-slot="today-client-work-rows"]')).toHaveAttribute(
      "data-ready",
      "",
    );
    const row = page.locator('[data-slot="today-client-item"]', { hasText: title });
    await row.getByRole("button", { name: "Mark done" }).click();
    await expect(page.getByText(`Marked ${title} done`)).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);
    await flushSends(page);
    await expect.poll(() => itemStates(projectId)).toEqual(["approved"]);
    expect(await projectState(projectId)).not.toBe("completed");
    const toast = page.locator("[data-sonner-toast]", { hasText: "All deliverables done" });
    await expect(toast).toContainText("Today film is ready to complete.");
    await toast.getByRole("button", { name: "Complete project" }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/projects/${projectId}$`));
    await expect(stateChip(page, "Ready to complete")).toBeVisible();
    await removeClientFixture(client);
  });
});
