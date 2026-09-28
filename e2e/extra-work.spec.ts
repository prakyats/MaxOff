import { type Locator, type Page, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { addISTDays, todayIST } from "../src/core/time";
import { compDateLabel } from "../src/modules/leave/domain/credits";

import {
  expectBackStack,
  hydrated,
  memberIdOf,
  resetAttendanceAndLeave,
  rpcAs,
  runInstalled,
  serviceInsert,
  serviceSelect,
  signIn,
  startPrompt,
  USERS,
} from "./helpers";

/**
 * Extra work and comp leave (task 3b.2, PRODUCT §4.3a, WORKFLOWS §2 "Settled in 3b.2"): a member
 * notes overtime, the Owner grants comp leave from Approvals → Extra work, the member requests
 * comp leave (offered only with the credit, one date, use-by date shown), the Owner rejects and
 * the credit comes back, then revokes it with a reason the member reads, after which the leave
 * form offers no comp leave. Installed, the note dialog and the Owner's sheet-then-dialog follow
 * the back order (ARCHITECTURE §14.2 a).
 *
 * Runs in `desktop`, `mobile` (375px) and `mobile-lg` (430px), one seeded person per project
 * (`extra-<project>@maxoff.local`), reset at the start so it re-runs without `pnpm db:reset`.
 */

const PASSWORD = "extra-local-password";
const person = (info: TestInfo) => `extra-${info.project.name}@maxoff.local`;
const personName = (info: TestInfo) => `Test Extra Work (${info.project.name})`;
const isPhone = (info: TestInfo) => info.project.name.startsWith("mobile");

/** The last day of this IST month, as "use by d MMM" shows it. */
function monthEnd(today: string): string {
  const [y, m] = today.split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${today.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

function noteRows(page: Page): Locator {
  return page.locator('[data-slot="extra-work-note"]');
}

async function signInOwner(page: Page): Promise<void> {
  await page.context().clearCookies();
  await signIn(page, USERS.owner.email, USERS.owner.password);
}

test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });

test("a note, a grant, a comp leave request, a rejection and a revoke", async ({ page }, info) => {
  const email = person(info);
  const memberId = await memberIdOf(email);
  await resetAttendanceAndLeave(memberId);
  const today = todayIST();

  // The member notes overtime from the Extra work tab.
  await signIn(page, email, PASSWORD);
  await page.goto("/leave/extra-work");
  await expect(page.locator('[data-slot="comp-balance"]')).toHaveText("No comp leave available");
  await expect(page.getByText("No extra work noted yet")).toBeVisible();
  await page.getByRole("button", { name: "Add note" }).click();
  const dialog = page.locator('[data-slot="extra-work-note-dialog"]');
  await expect(dialog).toBeVisible();
  // Too short: a field message, nothing sent.
  await dialog.getByLabel("What you worked on").fill("ab");
  await dialog.getByRole("button", { name: "Send note" }).click();
  await expect(dialog.locator('[data-slot="field-error"]')).toContainText("Say what you worked on");
  await dialog.getByLabel("What you worked on").fill("Colour grade for the Sharma wedding");
  await dialog.getByRole("button", { name: "Send note" }).click();
  await expect(dialog).toBeHidden();
  await expect(noteRows(page)).toHaveCount(1);
  await expect(noteRows(page).first()).toContainText("Waiting for the Owner");
  // One note per day and kind.
  await page.getByRole("button", { name: "Add note" }).click();
  await dialog.getByLabel("What you worked on").fill("Another one");
  await dialog.getByRole("button", { name: "Send note" }).click();
  await expect(dialog.locator('[data-slot="form-alert"]')).toContainText("already added a note");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // The Owner grants a day from Approvals → Extra work (review-only: no Approve button).
  await signInOwner(page);
  await page.goto("/approvals");
  const group = page.locator('[data-slot="approval-group"][data-group="extra-work"]');
  const row = group.locator('[data-slot="approval-row"]').filter({ hasText: personName(info) });
  await expect(row).toContainText("Overtime");
  await expect(row.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await row.getByRole("button", { name: "Review" }).click();
  const sheet = page.locator('[data-slot="review-sheet"]');
  await expect(sheet).toContainText("Colour grade for the Sharma wedding");
  await sheet.getByRole("button", { name: "Decide…" }).click();
  const decide = page.locator('[data-slot="decide-note-dialog"]');
  await expect(decide.getByRole("button", { name: "Grant comp leave" })).toBeDisabled();
  await decide.getByRole("radio", { name: "Grant 1 day of comp leave" }).check();
  await decide.getByLabel("A note for them (optional)").fill("Thanks for the late night");
  await decide.getByRole("button", { name: "Grant comp leave" }).click();
  await expect(decide).toBeHidden();
  await expect(row).toHaveCount(0);

  // The member sees the outcome and the credit, and comp leave appears in the leave form.
  await page.context().clearCookies();
  await signIn(page, email, PASSWORD);
  await page.goto("/leave/extra-work");
  const useBy = monthEnd(today);
  await expect(noteRows(page).first()).toContainText("1 comp leave granted");
  await expect(page.locator('[data-slot="comp-balance"]')).toContainText("1 day of comp leave");
  const creditRow = page.locator('[data-slot="comp-credit"]').first();
  await expect(creditRow).toContainText("Available");
  await expect(creditRow).toContainText("The Owner's note: Thanks for the late night");

  await page.getByRole("button", { name: "Request leave" }).click();
  const form = page.getByRole("dialog", { name: "Request leave" });
  await form.getByLabel("Kind of leave").click();
  await page.getByRole("option", { name: "Comp leave (1 day)" }).click();
  await expect(form).toContainText("1 day of comp leave");
  // The date is picked from the working days up to the use-by date (3b review): the day after
  // the month's end is never offered (a weekly day off or a holiday isn't either; pgTAP 28).
  const date = today <= useBy ? today : useBy;
  await form.getByLabel("Date").click();
  await expect(page.getByRole("option", { name: compDateLabel(date) })).toBeVisible();
  await expect(page.getByRole("option", { name: compDateLabel(addISTDays(useBy, 1)) })).toHaveCount(
    0,
  );
  await page.getByRole("option", { name: compDateLabel(date) }).click();
  await form.getByRole("button", { name: "Request leave" }).click();
  await expect(form).toBeHidden();
  await expect(page).toHaveURL(/\/leave\/extra-work$/);
  // Requested: the credit waits on it and the balance is spent.
  await page.reload();
  await expect(page.locator('[data-slot="comp-balance"]')).toHaveText("No comp leave available");
  await expect(creditRow).toContainText("Waiting on a request");
  await page.getByRole("link", { name: "Leave requests", exact: true }).click();
  const requestRow = isPhone(info)
    ? page.locator('[data-slot="data-card"]').filter({ hasText: "Comp leave · 1 day" })
    : page.locator("tbody tr").filter({ hasText: "Comp leave · 1 day" });
  await expect(requestRow).toContainText("Waiting");

  // The Owner rejects: the credit comes back. Then revokes it with a reason.
  await signInOwner(page);
  await page.goto("/approvals");
  const leaveGroup = page.locator('[data-slot="approval-group"][data-group="leave"]');
  const leaveRow = leaveGroup
    .locator('[data-slot="approval-row"]')
    .filter({ hasText: personName(info) });
  await expect(leaveRow).toContainText("Comp leave · 1 day");
  await leaveRow.getByRole("button", { name: "Review" }).click();
  await page.locator('[data-slot="review-sheet"]').getByRole("button", { name: "Reject…" }).click();
  await page.getByLabel("Reason").fill("A shoot that day");
  await page.getByRole("button", { name: "Reject request" }).click();
  await expect(leaveRow).toHaveCount(0);

  await page.goto(`/people/${memberId}/leave`);
  const card = page.locator('[data-slot="comp-leave-card"]');
  await expect(card.locator('[data-slot="comp-balance"]')).toContainText("1 day of comp leave");
  await card.getByRole("button", { name: "Revoke" }).click();
  await page.getByLabel("Reason").fill("Granted by mistake");
  await page.getByRole("button", { name: "Revoke comp leave" }).click();
  await expect(card.locator('[data-slot="comp-credit"]').first()).toContainText("Revoked");
  await expect(card.locator('[data-slot="comp-balance"]')).toHaveText("No comp leave available");

  // A standalone grant, half a day, from the same card: a double tap grants it once (3b review).
  await card.getByRole("button", { name: "Grant comp leave" }).click();
  const grant = page.locator('[data-slot="grant-comp-leave-dialog"]');
  await grant.getByRole("radio", { name: "½ day" }).check();
  await grant.getByRole("button", { name: "Grant ½ day" }).dblclick();
  await expect(grant).toBeHidden();
  await expect(card.locator('[data-slot="comp-balance"]')).toContainText("½ day of comp leave");
  const halfGrants = await serviceSelect<{ id: string }>(
    `comp_leave_credits?select=id&member_id=eq.${memberId}&days=eq.0.5&revoked_at=is.null`,
  );
  expect(halfGrants).toHaveLength(1);

  // The member reads the revoke reason, and the form offers only the half day now.
  await page.context().clearCookies();
  await signIn(page, email, PASSWORD);
  await page.goto("/leave/extra-work");
  await expect(page.locator('[data-slot="comp-credit"][data-status="revoked"]')).toContainText(
    "The Owner's reason: Granted by mistake",
  );
  await page.getByRole("button", { name: "Request leave" }).click();
  await form.getByLabel("Kind of leave").click();
  await expect(page.getByRole("option", { name: "Comp leave (1 day)" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "Comp leave, half day (½)" })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("a day off worked: the note, and the Owner counts the day as worked", async ({
  page,
}, info) => {
  const email = person(info);
  const memberId = await memberIdOf(email);
  await resetAttendanceAndLeave(memberId);

  // The dialog offers the last 7 days, each with the note the calendar gives it: one of them is
  // a weekly day off (the suite pins today as a working day, so the off day is in the past).
  await signIn(page, email, PASSWORD);
  await page.goto("/leave/extra-work");
  await page.getByRole("button", { name: "Add note" }).click();
  const dialog = page.locator('[data-slot="extra-work-note-dialog"]');
  await dialog.getByLabel("Day").click();
  await page.getByRole("option").filter({ hasText: "worked on a day off" }).first().click();
  await expect(dialog).toContainText("I worked on a day off");
  await expect(dialog.getByLabel("Roughly how long (optional)")).toHaveCount(0);
  await dialog.getByLabel("What you worked on").fill("Covered the Mehta engagement shoot");
  await dialog.getByRole("button", { name: "Send note" }).click();
  await expect(dialog).toBeHidden();
  const [note] = await serviceSelect<{ work_date: string; kind: string }>(
    `extra_work_notes?member_id=eq.${memberId}&select=work_date,kind`,
  );
  expect(note?.kind).toBe("day_off");

  // The Owner reviews it: no comp leave, and the day counts as worked (never ticked for them).
  await signInOwner(page);
  await page.goto("/approvals");
  const row = page
    .locator('[data-slot="approval-group"][data-group="extra-work"] [data-slot="approval-row"]')
    .filter({ hasText: personName(info) });
  await expect(row).toContainText("Day off worked");
  await row.getByRole("button", { name: "Review" }).click();
  await page.locator('[data-slot="review-sheet"]').getByRole("button", { name: "Decide…" }).click();
  const decide = page.locator('[data-slot="decide-note-dialog"]');
  const worked = decide.getByRole("checkbox");
  await expect(worked).not.toBeChecked();
  await decide.getByRole("radio", { name: "No comp leave" }).check();
  await worked.check();
  await decide.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(decide).toBeHidden();
  await expect(row).toHaveCount(0);
  const [day] = await serviceSelect<{ state: string; final_status: string; is_day_off: boolean }>(
    `attendance_days?member_id=eq.${memberId}&work_date=eq.${note?.work_date}&select=state,final_status,is_day_off`,
  );
  expect(day).toEqual({ state: "corrected", final_status: "present", is_day_off: true });

  // The member reads the neutral outcome on the note.
  await page.context().clearCookies();
  await signIn(page, email, PASSWORD);
  await page.goto("/leave/extra-work");
  await expect(noteRows(page).first()).toContainText(
    "Reviewed by the Owner · Counted as a day worked",
  );
});

test("a prompt left open while the day starts elsewhere closes on its own Start day", async ({
  page,
}, info) => {
  const email = person(info);
  await resetAttendanceAndLeave(await memberIdOf(email));
  await signIn(page, email, PASSWORD, { day: "stop" });
  await expect(page).toHaveURL(/\/my-day$/);
  const prompt = startPrompt(page);
  await expect(prompt).toBeVisible();
  // Another device (a phone beside the laptop) starts the day first.
  await rpcAs(email, PASSWORD, "attendance_start_day", {});
  await prompt.getByRole("button", { name: "Start day" }).click();
  await expect(page.getByText("Your day has already started.")).toBeVisible();
  await expect(prompt).toBeHidden();
  await expect(page.locator('[data-slot="attendance-strip"]')).toHaveAttribute(
    "data-kind",
    "started",
  );
});

test.describe("installed: the back order of the note dialog and the Owner's decision", () => {
  test.skip(({ isMobile }) => !isMobile, "the installed app is a phone");

  test("back closes the note dialog and leaves the Extra work tab in one more back", async ({
    page,
  }, info) => {
    await runInstalled(page);
    await signIn(page, person(info), PASSWORD);
    await page.goto("/my-day");
    await page.goto("/leave/extra-work");
    await page.getByRole("button", { name: "Add note" }).click();
    const dialog = page.locator('[data-slot="extra-work-note-dialog"]');
    await expect(dialog).toBeVisible();
    await expectBackStack(page, [
      { closes: dialog, url: /\/leave\/extra-work$/ },
      { url: /\/my-day$/ },
    ]);
  });

  test("back closes the decide dialog, then the review sheet, then leaves Approvals", async ({
    page,
  }, info) => {
    const memberId = await memberIdOf(person(info));
    await resetAttendanceAndLeave(memberId);
    await runInstalled(page);
    await signIn(page, person(info), PASSWORD);
    await page.goto("/leave/extra-work");
    await page.getByRole("button", { name: "Add note" }).click();
    const dialog = page.locator('[data-slot="extra-work-note-dialog"]');
    await dialog.getByLabel("What you worked on").fill("Late render for the reel");
    await dialog.getByRole("button", { name: "Send note" }).click();
    await expect(dialog).toBeHidden();

    await page.context().clearCookies();
    await signIn(page, USERS.owner.email, USERS.owner.password);
    await page.goto("/today");
    await page.goto("/approvals");
    const row = page
      .locator('[data-slot="approval-group"][data-group="extra-work"] [data-slot="approval-row"]')
      .filter({ hasText: personName(info) });
    await row.getByRole("button", { name: "Review" }).click();
    const sheet = page.locator('[data-slot="review-sheet"]');
    await sheet.getByRole("button", { name: "Decide…" }).click();
    const decide = page.locator('[data-slot="decide-note-dialog"]');
    await expect(decide).toBeVisible();
    await expectBackStack(page, [
      { closes: decide, url: /\/approvals$/ },
      { closes: sheet, url: /\/approvals$/ },
      { url: /\/today$/ },
    ]);
  });

  const LEFT = { url: /^about:blank$/ };

  test("End day: back closes the overtime select, then the confirmation, then leaves", async ({
    page,
  }, info) => {
    await resetAttendanceAndLeave(await memberIdOf(person(info)));
    await runInstalled(page);
    // Signed in with the day started from the prompt: home with nothing of ours beneath it.
    await signIn(page, person(info), PASSWORD);
    await expect(page).toHaveURL(/\/my-day$/);
    await page
      .locator('[data-slot="attendance-strip"]')
      .getByRole("button", { name: "End day" })
      .click();
    const confirm = page.getByRole("alertdialog", { name: "End your day?" });
    await confirm.getByRole("button", { name: "Worked late? Add an overtime note" }).click();
    await confirm.getByLabel("Roughly how long (optional)").click();
    const select = page.locator('[data-slot="select-sheet"]');
    await expect(select).toBeVisible();
    await expectBackStack(page, [
      { closes: select, url: /\/my-day$/ },
      { closes: confirm, url: /\/my-day$/ },
      LEFT,
    ]);
  });

  test("on approved leave: back closes the I'm working today confirmation, then leaves", async ({
    page,
  }, info) => {
    const memberId = await memberIdOf(person(info));
    await resetAttendanceAndLeave(memberId);
    const today = todayIST();
    const requestId = await rpcAs<string>(person(info), PASSWORD, "leave_submit", {
      type: "leave",
      start_date: today,
      end_date: today,
    });
    await rpcAs(USERS.owner.email, USERS.owner.password, "leave_decide", {
      request_id: requestId,
      decision: "approve",
    });
    await runInstalled(page);
    await signIn(page, person(info), PASSWORD, { day: "stop" });
    await expect(page).toHaveURL(/\/my-day$/);
    await hydrated(page);
    await page
      .locator('[data-slot="attendance-strip"]')
      .getByRole("button", { name: "I'm working today" })
      .click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await expectBackStack(page, [{ closes: confirm, url: /\/my-day$/ }, LEFT]);
  });

  test("on a day off: back closes the strip's I worked today note, then leaves", async ({
    page,
  }, info) => {
    const memberId = await memberIdOf(person(info));
    await resetAttendanceAndLeave(memberId);
    // A day-off row for this person only (the suite keeps today a working day for everyone).
    await serviceInsert("attendance_days", {
      member_id: memberId,
      work_date: todayIST(),
      is_day_off: true,
    });
    await runInstalled(page);
    await signIn(page, person(info), PASSWORD, { day: "stop" });
    await expect(page).toHaveURL(/\/my-day$/);
    await hydrated(page);
    await page
      .locator('[data-slot="attendance-strip"]')
      .getByRole("button", { name: "I worked today" })
      .click();
    const note = page.getByRole("dialog");
    await expect(note).toBeVisible();
    await expectBackStack(page, [{ closes: note, url: /\/my-day$/ }, LEFT]);
  });

  test("the prompt's leave view is the same layer: one back closes it", async ({ page }, info) => {
    await resetAttendanceAndLeave(await memberIdOf(person(info)));
    await runInstalled(page);
    await signIn(page, person(info), PASSWORD, { day: "stop" });
    await expect(page).toHaveURL(/\/my-day$/);
    const prompt = startPrompt(page);
    await prompt.getByRole("button", { name: "On leave today? Choose leave" }).click();
    await expect(prompt.getByRole("heading", { name: "On leave today?" })).toBeVisible();
    await expectBackStack(page, [{ closes: prompt, url: /\/my-day$/ }, LEFT]);
  });

  test("the tabs replace, and back closes the comp leave select, then the form, then leaves", async ({
    page,
  }, info) => {
    const memberId = await memberIdOf(person(info));
    await resetAttendanceAndLeave(memberId);
    await rpcAs(USERS.owner.email, USERS.owner.password, "comp_leave_grant", {
      member_id: memberId,
      days: 1,
    });
    await runInstalled(page);
    await signIn(page, person(info), PASSWORD);
    await page.goto("/my-day");
    await page.goto("/leave/extra-work");
    // View controls never add history (§14.2 d).
    await page.getByRole("link", { name: "Attendance", exact: true }).click();
    await expect(page).toHaveURL(/\/leave\/attendance$/);
    await page.getByRole("link", { name: "Extra work", exact: true }).click();
    await expect(page).toHaveURL(/\/leave\/extra-work$/);
    await page.getByRole("button", { name: "Request leave" }).click();
    const form = page.getByRole("dialog", { name: "Request leave" });
    await form.getByLabel("Kind of leave").click();
    const select = page.locator('[data-slot="select-sheet"]');
    await expect(select.getByRole("option", { name: "Comp leave (1 day)" })).toBeVisible();
    await expectBackStack(page, [
      { closes: select, url: /\/leave\/extra-work$/ },
      { closes: form, url: /\/leave\/extra-work$/ },
      { url: /\/my-day$/ },
    ]);
  });

  test("the Owner's Grant and Revoke dialogs close on back, then the page is left", async ({
    page,
  }, info) => {
    const memberId = await memberIdOf(person(info));
    await runInstalled(page);
    await signIn(page, USERS.owner.email, USERS.owner.password);
    await page.goto("/today");
    await page.goto(`/people/${memberId}/leave`);
    const card = page.locator('[data-slot="comp-leave-card"]');
    await card.getByRole("button", { name: "Grant comp leave" }).click();
    const grant = page.locator('[data-slot="grant-comp-leave-dialog"]');
    await expect(grant).toBeVisible();
    await expectBackStack(page, [{ closes: grant, url: /\/leave$/ }]);
    // The previous test's credit is unused, so Revoke is offered.
    await card.getByRole("button", { name: "Revoke" }).click();
    const revoke = page.getByRole("dialog").or(page.getByRole("alertdialog"));
    await expect(revoke).toBeVisible();
    await expectBackStack(page, [{ closes: revoke, url: /\/leave$/ }, { url: /\/today$/ }]);
  });
});
