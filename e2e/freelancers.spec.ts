import { type Locator, type Page, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { addISTDays, istInstant, istWeekday, todayIST } from "../src/core/time";

import {
  expectBackStack,
  memberIdOf,
  pageHeader,
  removeFixturePerson,
  removeFreelancersNamed,
  removeTasksTitled,
  rpcAs,
  runInstalled,
  serviceSelect,
  signIn,
  storageStateFor,
  taskTypeId,
  USERS,
} from "./helpers";

/**
 * Freelancers around People, 4C (task 4.5; PRODUCT §4.17, ADR-0013, WORKFLOWS §1b, Kickoff 4
 * decisions 7, 8, 20): "Add person" as a freelancer with a coordinator, the list naming the
 * coordinator, a freelancer's page with no Leave, Attendance or Month; "Change coordinator" with
 * its history and reason; the coordinator's freelancers on /me; the Owner's "Invite as employee"
 * (same record, the warning about open tasks); deactivating a coordinator, which first asks
 * where their freelancers go, and a freelancer's return behind a coordinator. Installed at 375
 * and 430px: the back order of the new dialogs; and the screens at 130% and 200% text.
 *
 * Each project has its own two coordinators (`people-coord[2]-<project>@maxoff.local`,
 * `supabase/seed.sql`) and its own freelancer names (one prefix), so the projects run side by
 * side; the tests of a project share them and run in order.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStateFor("owner") });

const PASSWORD = "people-local-password";

function people(info: TestInfo) {
  const project = info.project.name;
  return {
    coord: {
      email: `people-coord-${project}@maxoff.local`,
      name: `Test People Coordinator (${project})`,
    },
    coord2: {
      email: `people-coord2-${project}@maxoff.local`,
      name: `Test People Coordinator B (${project})`,
    },
    admin: { email: `list-admin-${project}@maxoff.local`, password: "list-local-password" },
    invitee: `free-invite-${project}@maxoff.local`,
  };
}

function prefixOf(info: TestInfo): string {
  return `Free ${info.project.name} `;
}

/** A weekday (Mon–Fri) at least `offset` days from today, IST, never 2 Oct (a seeded holiday). */
function workingDay(offset: number): string {
  let day = addISTDays(todayIST(), offset);
  while (istWeekday(day) === 0 || istWeekday(day) === 6 || day === "2026-10-02") {
    day = addISTDays(day, 1);
  }
  return day;
}

const owner = (fn: string, args: Record<string, unknown>) =>
  rpcAs<string>(USERS.owner.email, USERS.owner.password, fn, args);

/** Both coordinators active again, whatever an interrupted run left (the Owner's own call). */
async function coordinatorsActive(info: TestInfo): Promise<{ coord: string; coord2: string }> {
  const who = people(info);
  const ids = {
    coord: await memberIdOf(who.coord.email),
    coord2: await memberIdOf(who.coord2.email),
  };
  for (const id of Object.values(ids)) {
    const [row] = await serviceSelect<{ status: string }>(`members?id=eq.${id}&select=status`);
    if (row?.status === "deactivated") await owner("member_reactivate", { member_id: id });
  }
  return ids;
}

/** A clean slate for the project: its tasks, its freelancers and the invitee go first. */
async function fresh(info: TestInfo): Promise<{ coord: string; coord2: string }> {
  const prefix = prefixOf(info);
  await removeTasksTitled(prefix);
  await removeFixturePerson(people(info).invitee);
  await removeFreelancersNamed(prefix);
  return coordinatorsActive(info);
}

async function addFreelancer(name: string, coordinatorId: string): Promise<string> {
  return owner("member_add_freelancer", { full_name: name, coordinator_id: coordinatorId });
}

async function freelancerId(name: string): Promise<string> {
  const rows = await serviceSelect<{ id: string }>(
    `members?full_name=eq.${encodeURIComponent(name)}&select=id`,
  );
  expect(rows, `one member named ${name}`).toHaveLength(1);
  return rows[0]!.id;
}

async function currentCoordinator(
  memberId: string,
): Promise<{ coordinator_id: string; reason: string | null } | undefined> {
  const [row] = await serviceSelect<{ coordinator_id: string; reason: string | null }>(
    `member_coordinators?member_id=eq.${memberId}&to_at=is.null&select=coordinator_id,reason`,
  );
  return row;
}

/** The person's page, its header painted (the layout streams it in behind a skeleton). */
async function openPerson(page: Page, id: string, name: string): Promise<void> {
  await page.goto(`/people/${id}`);
  await expect(pageHeader(page)).toContainText(name);
}

async function personMenu(page: Page, item: string): Promise<void> {
  await page.locator('[data-slot="person-menu"]:visible').click();
  await page.getByRole("menuitem", { name: item }).click();
}

async function choose(scope: Page | Locator, label: string | RegExp, option: string) {
  await scope.getByRole("combobox", { name: label }).click();
  const page = "page" in scope ? scope.page() : scope;
  await page.getByRole("option", { name: option, exact: true }).click();
}

test.describe("freelancers around People, the flows", () => {
  // The flows prove behaviour, which 55px of width does not change: 1280 and 375px only.
  test.skip(({ viewport }) => viewport?.width === 430, "flows run at 1280 and 375px");

  test("Add person as a freelancer: the list names the coordinator; their page has no Leave, Attendance or Month", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    await fresh(info);
    const who = people(info);
    const name = `${prefix}Asha`;

    await page.goto("/people");
    await page.getByRole("button", { name: "Add person", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add someone" });
    await dialog.getByRole("radio", { name: /Freelancer/ }).check();
    await expect(dialog.getByLabel("Email")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Add freelancer" }).click();
    await expect(dialog.locator('[data-slot="field-error"]').first()).toBeVisible();

    await dialog.getByLabel("Full name").fill(name);
    await choose(dialog, "Coordinator", who.coord.name);
    await dialog.getByLabel("Phone (optional)").fill("98450 11223");
    await dialog.getByRole("button", { name: "Add freelancer" }).click();
    await expect(page.getByText(`${name} added`)).toBeVisible();
    await expect(dialog).toBeHidden();

    // The list: "Freelancer" and who looks after them (ADR-0013).
    await expect(
      page.getByText(`with ${who.coord.name}`).filter({ visible: true }).first(),
    ).toBeVisible();
    const id = await freelancerId(name);
    expect(await currentCoordinator(id)).toMatchObject({
      coordinator_id: await memberIdOf(who.coord.email),
    });

    await page.locator(`main a[href="/people/${id}"]`).filter({ visible: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/people/${id}$`));
    await expect(pageHeader(page)).toContainText(name);
    const profile = page.locator('[data-slot="person-profile"]:visible');
    await expect(profile).toContainText("Freelancer");
    await expect(profile).toContainText("98450 11223");
    await expect(page.locator('[data-slot="person-coordinator-current"]:visible')).toContainText(
      who.coord.name,
    );
    // No attendance or leave for a freelancer (ADR-0013), so no tabs, and no tab by its URL.
    await expect(page.locator('[data-slot="person-tabs"]')).toHaveCount(0);
    for (const tab of ["attendance", "leave", "month"]) {
      await page.goto(`/people/${id}/${tab}`);
      await expect(page.locator('[data-slot="error-state"]:visible')).toContainText(
        "Page not found",
      );
    }
  });

  test("Change coordinator keeps the history with its reason; the new coordinator sees them on /me", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    const ids = await fresh(info);
    const who = people(info);
    const name = `${prefix}Ravi`;
    const id = await addFreelancer(name, ids.coord);

    await openPerson(page, id, name);
    await page.locator('[data-slot="change-coordinator"]:visible').click();
    const dialog = page.getByRole("dialog", { name: `Change ${name}'s coordinator` });
    await expect(dialog).toContainText(`${who.coord.name} looks after them now`);
    const commit = dialog.getByRole("button", { name: "Choose a coordinator" });
    await expect(commit).toBeDisabled();
    await choose(dialog, "New coordinator", who.coord2.name);
    await dialog.getByLabel("Reason (optional)").fill("Closer to the Pune shoots");
    await dialog.getByRole("button", { name: `Make ${who.coord2.name} the coordinator` }).click();
    await expect(page.getByText(`${who.coord2.name} looks after ${name} now`)).toBeVisible();
    await expect(dialog).toBeHidden();

    const card = page.locator('[data-slot="person-coordinator"]:visible');
    await expect(card.locator('[data-slot="person-coordinator-current"]')).toContainText(
      who.coord2.name,
    );
    await expect(card).toContainText("Closer to the Pune shoots");
    await expect(card.locator('[data-slot="person-coordinator-history"]')).toContainText(
      who.coord.name,
    );
    expect(await currentCoordinator(id)).toEqual({
      coordinator_id: ids.coord2,
      reason: "Closer to the Pune shoots",
    });

    // An Admin reads the history and the reason too (Kickoff 4 decision 20), with no Change.
    await page.context().clearCookies();
    await signIn(page, who.admin.email, who.admin.password);
    await openPerson(page, id, name);
    await expect(page.locator('[data-slot="person-coordinator"]:visible')).toContainText(
      "Closer to the Pune shoots",
    );
    await expect(page.locator('[data-slot="change-coordinator"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="person-menu"]')).toHaveCount(0);

    // The new coordinator's /me lists them; the reason is never there (4A review S4).
    await page.context().clearCookies();
    await signIn(page, who.coord2.email, PASSWORD);
    await page.goto("/me");
    const mine = page.locator('[data-slot="me-freelancers"]:visible');
    await expect(mine).toContainText(name);
    await expect(mine).not.toContainText("Pune");
    // The one before looks after nobody now.
    await page.context().clearCookies();
    await signIn(page, who.coord.email, PASSWORD);
    await page.goto("/me");
    await expect(page.getByRole("button", { name: "Edit profile" })).toBeVisible();
    await expect(page.locator('[data-slot="me-freelancers"]')).toHaveCount(0);
  });

  test("Invite as employee: the warning counts their open tasks; the same record becomes an invited employee", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    const ids = await fresh(info);
    const who = people(info);
    const name = `${prefix}Meera`;
    const id = await addFreelancer(name, ids.coord);
    await owner("task_create", {
      title: `${prefix}edit the teaser`,
      description: null,
      task_type_id: await taskTypeId("Normal"),
      client_id: null,
      priority: "medium",
      due_at: istInstant(workingDay(20), "18:00"),
      assignee_ids: [id],
      primary_owner_id: id,
      approving_admin_id: null,
    });

    await openPerson(page, id, name);
    await personMenu(page, "Invite as employee");
    const dialog = page.getByRole("dialog", { name: `Invite ${name} as an employee?` });
    await expect(dialog.locator('[data-slot="invite-employee-warning"]')).toContainText(
      "hand in their open task,",
    );
    await dialog.getByRole("button", { name: `Invite ${name}` }).click();
    await expect(dialog.locator('[data-slot="field-error"]').first()).toBeVisible();
    await dialog.getByLabel("Email").fill(who.invitee);
    await dialog.getByRole("button", { name: `Invite ${name}` }).click();
    await expect(page.getByRole("heading", { name: `${name} is invited` })).toBeVisible();
    await expect(page.locator('[data-slot="invite-link"]')).toHaveValue(/type=invite/);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Same id, now an invited employee; the coordinator row closed, kept as history.
    const [row] = await serviceSelect<{ engagement: string; status: string; email: string }>(
      `members?id=eq.${id}&select=engagement,status,email`,
    );
    expect(row).toEqual({ engagement: "permanent", status: "invited", email: who.invitee });
    expect(await currentCoordinator(id)).toBeUndefined();
    const profile = page.locator('[data-slot="person-profile"]:visible');
    await expect(profile).toContainText("Invited");
    await expect(profile).toContainText(who.invitee);
    await expect(page.locator('[data-slot="person-coordinator"]:visible')).toContainText(
      "Coordinators as a freelancer",
    );
  });

  test("Deactivating a coordinator first moves their freelancers; a freelancer comes back behind a coordinator", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    const ids = await fresh(info);
    const who = people(info);
    const name = `${prefix}Kiran`;
    const id = await addFreelancer(name, ids.coord);

    try {
      await openPerson(page, ids.coord, who.coord.name);
      await personMenu(page, "Deactivate");
      const dialog = page.getByRole("dialog", { name: `Deactivate ${who.coord.name}?` });
      const handover = dialog.locator('[data-slot="freelancer-handover"]');
      await expect(handover).toContainText("1 freelancer");
      const commit = dialog.getByRole("button", { name: `Deactivate ${who.coord.name}` });
      await expect(commit).toBeDisabled();
      await choose(dialog, `Move ${who.coord.name}'s 1 freelancer to`, who.coord2.name);
      await expect(commit).toBeEnabled();
      await commit.click();
      await expect(dialog).toBeHidden();
      await expect(page.locator('[data-slot="person-profile"]:visible')).toContainText(
        "Deactivated",
      );
      expect(await currentCoordinator(id)).toEqual({
        coordinator_id: ids.coord2,
        reason: "Their coordinator was deactivated",
      });
    } finally {
      await coordinatorsActive(info);
    }

    // The freelancer leaves (their coordinator row closes) and comes back behind one (4A (a)).
    await owner("member_deactivate", { member_id: id });
    await openPerson(page, id, name);
    await expect(page.locator('[data-slot="person-coordinator-current"]:visible')).toContainText(
      "Nobody now",
    );
    await personMenu(page, "Reactivate");
    const dialog = page.getByRole("dialog", { name: `Reactivate ${name}?` });
    const commit = dialog.getByRole("button", { name: `Reactivate ${name}` });
    await expect(commit).toBeDisabled();
    await choose(dialog, "Coordinator", who.coord.name);
    await commit.click();
    await expect(page.getByText(`${name} is active again`)).toBeVisible();
    expect(await currentCoordinator(id)).toMatchObject({ coordinator_id: ids.coord });
    await expect(page.locator('[data-slot="person-coordinator-current"]:visible')).toContainText(
      who.coord.name,
    );
  });
});

test.describe("freelancers, installed: back and large text", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) >= 768, "the installed app is a phone");

  test("Add person, Change coordinator and Invite as employee close on back before the page", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    const ids = await fresh(info);
    const name = `${prefix}Back`;
    const id = await addFreelancer(name, ids.coord);
    await runInstalled(page);
    await page.goto("/today");
    await page.goto("/people");

    await page
      .locator('[data-slot="page-actions"]')
      .getByRole("button", { name: "Add person" })
      .click();
    const add = page.getByRole("dialog", { name: "Add someone" });
    await add.getByRole("radio", { name: /Freelancer/ }).check();
    await add.getByRole("combobox", { name: "Coordinator" }).click();
    const sheet = page.locator('[data-slot="select-sheet"]');
    await expect(sheet.getByRole("listbox")).toBeVisible();
    await expectBackStack(page, [
      { closes: sheet, url: /\/people$/ },
      { closes: add, url: /\/people$/ },
    ]);

    await page.locator(`main a[href="/people/${id}"]`).filter({ visible: true }).first().click();
    const person = new RegExp(`/people/${id}$`);
    await expect(page).toHaveURL(person);
    await expect(pageHeader(page)).toContainText(name);

    await page.locator('[data-slot="change-coordinator"]:visible').click();
    const change = page.getByRole("dialog", { name: `Change ${name}'s coordinator` });
    await expect(change).toBeVisible();
    await expectBackStack(page, [{ closes: change, url: person }]);

    await personMenu(page, "Invite as employee");
    const invite = page.getByRole("dialog", { name: `Invite ${name} as an employee?` });
    await expect(invite).toBeVisible();
    await expectBackStack(page, [
      { closes: invite, url: person },
      { url: /\/people$/ },
      { url: /\/today$/ },
    ]);
  });

  test("Deactivating a coordinator and reactivating a freelancer: each picker's sheet, then its dialog, close on back", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    const ids = await fresh(info);
    const who = people(info);
    const name = `${prefix}Layers`;
    const id = await addFreelancer(name, ids.coord);
    await runInstalled(page);
    // The coordinator's page (People lists ten at a time on a phone, so opened by its address).
    await openPerson(page, ids.coord, who.coord.name);
    const coordinator = new RegExp(`/people/${ids.coord}$`);
    await personMenu(page, "Deactivate");
    const deactivate = page.getByRole("dialog", { name: `Deactivate ${who.coord.name}?` });
    await deactivate
      .getByRole("combobox", { name: `Move ${who.coord.name}'s 1 freelancer to` })
      .click();
    const sheet = page.locator('[data-slot="select-sheet"]');
    await expect(sheet.getByRole("listbox")).toBeVisible();
    await expectBackStack(page, [
      { closes: sheet, url: coordinator },
      { closes: deactivate, url: coordinator },
    ]);
    // Nothing was decided on the way: the coordinator is still active, the freelancer theirs.
    expect(await currentCoordinator(id)).toMatchObject({ coordinator_id: ids.coord });

    await owner("member_deactivate", { member_id: id });
    await page.goto(`/people/${id}`);
    const freelancer = new RegExp(`/people/${id}$`);
    await expect(pageHeader(page)).toContainText(name);
    await personMenu(page, "Reactivate");
    const reactivate = page.getByRole("dialog", { name: `Reactivate ${name}?` });
    await reactivate.getByRole("combobox", { name: "Coordinator" }).click();
    await expect(sheet.getByRole("listbox")).toBeVisible();
    await expectBackStack(page, [
      { closes: sheet, url: freelancer },
      { closes: reactivate, url: freelancer },
    ]);
    const [row] = await serviceSelect<{ status: string }>(`members?id=eq.${id}&select=status`);
    expect(row?.status).toBe("deactivated");
  });

  test("People, a freelancer's page and a coordinator's /me fit at 130% and 200% text", async ({
    page,
  }, info) => {
    const prefix = prefixOf(info);
    const ids = await fresh(info);
    const who = people(info);
    const name = `${prefix}Anantharamakrishnan Venkataraghavan`;
    const id = await addFreelancer(name, ids.coord);
    await owner("member_set_coordinator", {
      member_id: id,
      coordinator_id: ids.coord2,
      reason: "A long reason, to see that it wraps on a small phone and never pushes the page wide",
    });

    const screens: [string | null, string][] = [
      [null, "/people"],
      [null, `/people/${id}`],
      [who.coord2.email, "/me"],
    ];
    for (const [email, path] of screens) {
      if (email) {
        await page.context().clearCookies();
        await signIn(page, email, PASSWORD);
      }
      await page.goto(path);
      await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
      for (const scale of [130, 200]) {
        await page.evaluate((percent) => {
          document.documentElement.style.fontSize = `${percent}%`;
        }, scale);
        await expectFits(page);
      }
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "";
      });
    }
  });
});

async function expectFits(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    wide: [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}${el.dataset.slot ? `[${el.dataset.slot}]` : ""}`),
  }));
  expect(overflow.wide, "nothing reaches past the right edge").toEqual([]);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}
