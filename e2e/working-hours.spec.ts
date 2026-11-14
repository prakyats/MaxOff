import type { Browser, Locator, Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

// The app's own clock (ADR-0008).
import { systemClock } from "../src/core/time";

import {
  animationsSettled,
  expectBackStack,
  expectNoHorizontalScroll,
  hydrated,
  memberIdOf,
  resetAttendanceAndLeaveOf,
  rpcAs,
  runInstalled,
  serviceSelect,
  serviceUpdate,
  signIn,
  startPrompt,
  storageStateFor,
} from "./helpers";
import { dayHours, END_MARGIN, hhmm, LAST_MINUTE } from "./working-hours-day";

/**
 * v1.9 W4: working hours, the screens (the owner-approved samples `docs/design/v19-working-hours-
 * sample.html` and `v19-screens-sample.html`; WORKFLOWS §1 "Working hours, late starts and leaving
 * early"). A late Start day asks the reason; before the end time End day is "Ask to leave early";
 * the Owner approves (the day ends at the ask) or asks them to stay; with no answer after the wait
 * the person may end the day ("Left early, not answered"), which the Owner later approves or
 * corrects; "Stay until" behind a person's row on the board; the Owner's Late line on Today; the
 * month counts; Morning / Afternoon in Choose leave and the leave form; the Thresholds fields; and
 * the switch off, which brings back today's screens.
 *
 * The switch and the day's start and end are organisation-wide, so these run alone after every
 * other project, one test at a time (`working-hours`, `-375`, `-430` in playwright.config.ts), with
 * the start and end set around the run's own clock (IST), and the switch turned off again at the
 * end of each test (the rest of the suite runs with it off, `global-setup.ts`). Each project uses
 * the working-day spec's seeded people of the matching width (`gate-<kind>-<project>@…`), reset
 * first.
 */

const PASSWORD = "gate-local-password";
type Kind = "staff" | "admin" | "leave" | "half";

/** The working-day people of the matching width: those projects have finished by now. */
function person(kind: Kind, info: TestInfo): string {
  const width = info.project.name.endsWith("-375")
    ? "mobile"
    : info.project.name.endsWith("-430")
      ? "mobile-lg"
      : "desktop";
  return `gate-${kind}-${width}@maxoff.local`;
}

const isPhone = (info: TestInfo) => /-(375|430)$/.test(info.project.name);

/** Minutes since IST midnight, now. */
function istNow(): number {
  const [h, m] = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(systemClock())
    .split(":")
    .map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** "6:00 pm" for minutes since midnight (the app's words, `formatWallTime`). */
function wall(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/**
 * The working hours on, around the run's own clock (IST), inside the day (`dayHours`: the margins,
 * and the loud failure outside 00:01-23:56 IST). The clock's edges, a day from 00:00 to 23:59 with
 * no grace, are pgTAP 121's (X5, owner via the advisor, #89, 11 Nov 2026): the e2e owns the
 * screens, pgTAP owns the clock. The margins are asserted here too, on the values set.
 */
async function hoursAround(
  startAgo: number,
  endIn: number,
): Promise<{ end: number; startedAgo: number; grace: number }> {
  const now = istNow();
  const { start, end, startedAgo, grace } = dayHours(now, startAgo, endIn);
  if (startAgo > 15) expect(startedAgo, "a late start: past the grace").toBeGreaterThan(grace);
  expect(end - now, "the day's end: whole minutes away").toBeGreaterThanOrEqual(END_MARGIN);
  expect(LAST_MINUTE - end, "room for a Stay until after the end").toBeGreaterThanOrEqual(1);
  await serviceUpdate("org_settings?org_id=not.is.null", {
    working_hours_on: true,
    work_start_time: hhmm(start),
    work_end_time: hhmm(end),
    late_grace_minutes: grace,
    early_leave_wait_minutes: 30,
  });
  return { end, startedAgo, grace };
}

/** Back to the suite's settings: the switch off and the launch hours. */
async function hoursOff(): Promise<void> {
  await serviceUpdate("org_settings?org_id=not.is.null", {
    working_hours_on: false,
    work_start_time: "10:00",
    work_end_time: "18:00",
    late_grace_minutes: 15,
    early_leave_wait_minutes: 30,
  });
}

test.afterEach(hoursOff);

/** The person's today, as the database has it. */
async function dayOf(email: string) {
  const id = await memberIdOf(email);
  const [day] = await serviceSelect<{
    id: string;
    started_at: string | null;
    ended_at: string | null;
    late_minutes: number | null;
    late_reason: string | null;
    stay_until: string | null;
  }>(
    `attendance_days?member_id=eq.${id}&select=id,started_at,ended_at,late_minutes,late_reason,stay_until&order=work_date.desc&limit=1`,
  );
  return day;
}

async function requestOf(email: string) {
  const id = await memberIdOf(email);
  const [request] = await serviceSelect<{ id: string; state: string; requested_at: string }>(
    `early_leave_requests?member_id=eq.${id}&select=id,state,requested_at&order=requested_at.desc&limit=1`,
  );
  return request;
}

function strip(page: Page): Locator {
  return page.locator('[data-slot="attendance-strip"]');
}

/** The Owner, in a context of their own at this project's size. */
async function ownerPage(browser: Browser, info: TestInfo): Promise<Page> {
  const { viewport, hasTouch, isMobile } = info.project.use;
  const context = await browser.newContext({
    storageState: storageStateFor("owner"),
    ...(viewport ? { viewport } : {}),
    ...(hasTouch !== undefined ? { hasTouch } : {}),
    ...(isMobile !== undefined ? { isMobile } : {}),
  });
  return context.newPage();
}

/** A person whose day started a few minutes ago, signed in on their home screen. */
async function startedPerson(page: Page, email: string): Promise<void> {
  await resetAttendanceAndLeaveOf(email);
  await rpcAs(email, PASSWORD, "attendance_start_day", {});
  await signIn(page, email, PASSWORD);
  await hydrated(page);
}

/**
 * 44 px targets and nothing past the edge (ARCHITECTURE §14.1), on a phone. Measured at rest: a
 * button just tapped is still easing back from its 0.97 press scale (`pressable`, 120 ms), and a
 * bounding box includes the transform (CI run 41524114062: "Ask the Owner" read 43.82 px, which is
 * 44 × 0.996, 28 ms after its tap; its layout box is 44).
 */
async function expectFits(page: Page, layer: Locator, info: TestInfo): Promise<void> {
  if (!isPhone(info)) return;
  await animationsSettled(page);
  for (const button of await layer.getByRole("button").all()) {
    if (!(await button.isVisible())) continue;
    const box = await button.boundingBox();
    expect(box?.height ?? 0, await button.innerText()).toBeGreaterThanOrEqual(44);
  }
  await expectNoHorizontalScroll(page);
}

test("Crew: a late Start day asks the reason; the strip shows Late, the reason and the end time", async ({
  page,
}, info) => {
  const email = person("staff", info);
  await resetAttendanceAndLeaveOf(email);
  const { startedAgo } = await hoursAround(40, 120);
  await signIn(page, email, PASSWORD, { day: "stop" });
  const prompt = startPrompt(page);
  await expect(prompt).toBeVisible();
  // Just looking: the strip's Start day carries today's rule from the server render.
  await prompt.getByRole("button", { name: "Just looking" }).click();
  await expect(prompt).toBeHidden();
  await expect(strip(page).locator('[data-slot="attendance-status"]')).toHaveText(
    /^Start your day · work starts \d{1,2}:\d{2} [ap]m$/,
  );

  await strip(page)
    .getByRole("button", { name: /^Start day/ })
    .click();
  const sheet = page.locator('[data-slot="late-sheet"]');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(/You're starting \d+ minutes late/);
  await expect(sheet).toContainText("Add a line for the Owner. It doesn't stop you working.");
  await expectFits(page, sheet, info);
  await sheet.getByLabel("Reason (optional)").fill("Traffic");
  await sheet.getByRole("button", { name: "Start day" }).click();
  await expect(sheet).toBeHidden();

  const hours = strip(page).locator('[data-slot="attendance-hours"]');
  await expect(hours).toContainText(/Late \d+ min/);
  await expect(hours.locator('[data-slot="attendance-late-reason"]')).toHaveText("“Traffic”");
  await expect(hours.locator('[data-slot="attendance-end-line"]')).toHaveText(
    /^Your day ends at \d{1,2}:\d{2} [ap]m$/,
  );
  // The usual " · " between the late part and the day's end (the design pass).
  await expect(hours.locator('[data-slot="attendance-hours-sep"]')).toHaveText("·");
  // Before the end time End day is "Ask to leave early".
  await expect(strip(page).getByRole("button", { name: "Ask to leave early" })).toBeVisible();
  await expect(strip(page).getByRole("button", { name: "End day" })).toHaveCount(0);
  const day = await dayOf(email);
  // As late as the start that was set (a minute may pass between setting it and the tap).
  expect(day?.late_minutes ?? 0).toBeGreaterThanOrEqual(startedAgo - 1);
  expect(day?.late_reason).toBe("Traffic");
  // The strip's second row fits the phone (the toast's own list slides in from the edge: gone first).
  await expect(page.getByText("Your day has started")).toBeHidden();
  await expectNoHorizontalScroll(page);
});

test("ask to leave early, the Owner approves: the day ends at the time asked", async ({
  page,
  browser,
}, info) => {
  const email = person("staff", info);
  await hoursAround(5, 120);
  await startedPerson(page, email);
  // W4 Q2: the Owner's Approvals badge before the ask, to see the ask join it.
  const owner = await ownerPage(browser, info);
  await owner.goto("/today");
  await hydrated(owner);
  const badgeOf = async () =>
    Number(
      (
        await owner
          .locator('[data-nav="approvals"] [data-slot="nav-badge"]')
          .evaluateAll((badges) =>
            badges
              .filter((badge) => (badge as HTMLElement).offsetParent !== null)
              .map((badge) => badge.textContent?.trim() ?? ""),
          )
      )[0] ?? "0",
    );
  const before = await badgeOf();
  await strip(page).getByRole("button", { name: "Ask to leave early" }).click();
  const sheet = page.locator('[data-slot="ask-leave-early-sheet"]');
  await expect(sheet).toContainText(
    /Your day ends at .+\. The Owner decides\. If there's no answer in 30 minutes, you can end your day\./,
  );
  await expect(sheet.locator('[data-slot="ask-leave-at"]')).toHaveText(/\d{1,2}:\d{2} [ap]m/);
  // Why is required.
  await sheet.getByRole("button", { name: "Ask the Owner" }).click();
  await expect(sheet.locator('[data-slot="field-error"]')).toHaveText(
    "Say why you need to leave early.",
  );
  await expectFits(page, sheet, info);
  await sheet.getByLabel("Why").fill("Doctor's appointment at 5");
  await sheet.getByRole("button", { name: "Ask the Owner" }).click();
  await expect(sheet).toBeHidden();
  const early = strip(page).locator('[data-slot="attendance-early"]');
  await expect(early).toContainText("Waiting");
  await expect(early).toContainText(/Asked to leave at .+ · \d+ min ago\. You can end your day at/);
  // Waiting: no button until the answer or the wait.
  await expect(strip(page).getByRole("button", { name: /End day|Ask to leave early/ })).toHaveCount(
    0,
  );
  const asked = await requestOf(email);
  expect(asked?.state).toBe("waiting");

  // W4 Q2: the badge counts it (from the shell's one read), and Today's Needs you lists it: the
  // kind, the time and reason, how long it has waited, one outlined Approve; the row opens its
  // group on Approvals.
  const name = (
    await serviceSelect<{ full_name: string }>(
      `members?email=eq.${encodeURIComponent(email)}&select=full_name`,
    )
  )[0]!.full_name;
  await owner.reload();
  await hydrated(owner);
  await expect.poll(badgeOf).toBe(before + 1);
  const todayRow = owner
    .locator(
      '[data-slot="today-approval-rows"] [data-slot="approval-row"][data-group="early-leave"]',
    )
    .filter({ hasText: name });
  await expect(todayRow.locator('[data-slot="approval-kind"]')).toHaveText("Leaving early");
  await expect(todayRow.locator('[data-slot="approval-detail"]')).toHaveText(
    /^Leave at \d{1,2}:\d{2} [ap]m · “Doctor's appointment at 5”$/,
  );
  await expect(todayRow.locator('[data-slot="approval-waiting"]')).toHaveText(/^Waiting /);
  await expect(todayRow.locator("[data-variant]")).toHaveCount(1);
  await expect(todayRow.locator("[data-variant]")).toHaveAttribute("data-variant", "secondary");
  await expect(todayRow.locator("[data-variant]")).toHaveText("Approve");
  await todayRow.locator('[data-slot="approval-row-open"]').click();
  await expect(owner).toHaveURL(/\/approvals#early-leave$/);
  const row = owner.locator('[data-slot="approval-row"][data-group="early-leave"]', {
    hasText: "Doctor's appointment at 5",
  });
  await expect(row).toContainText(/leave at \d{1,2}:\d{2} [ap]m/);
  await expect(row).toContainText(/waiting \d+ min/);
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(owner.getByText(/can leave: their day ended at the time they asked/)).toBeVisible();
  await expect.poll(async () => (await requestOf(email))?.state).toBe("approved");
  const day = await dayOf(email);
  expect(day?.ended_at && new Date(day.ended_at).getTime()).toBe(
    new Date(asked!.requested_at).getTime(),
  );
  await owner.context().close();

  await page.reload();
  await expect(strip(page).locator('[data-slot="attendance-early"]')).toContainText(
    /The Owner approved\. Your day ended at/,
  );
  // W4 Q1 (advisor 2 Nov): the approval ended the day without End day's expenses question, so a
  // quiet link opens the same claim form, for today; closing it claims nothing.
  const claim = strip(page).locator('[data-slot="early-leave-claim"]');
  await expect(claim).toHaveText("Any expenses to claim today?");
  await expect(claim).toHaveAttribute("data-variant", "ghost");
  await claim.click();
  const form = page.getByRole("dialog");
  await expect(form.getByRole("heading", { name: "Expenses to claim" })).toBeVisible();
  await expect(form.getByLabel("Amount (₹)")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();
  await expect(claim).toBeVisible();
});

test("ask to leave early, the Owner says Stay: the message, and the ask again", async ({
  page,
  browser,
}, info) => {
  const email = person("admin", info);
  await hoursAround(5, 120);
  await startedPerson(page, email);
  await rpcAs(email, PASSWORD, "attendance_ask_leave_early", { reason: "Family function" });
  await page.reload();
  await expect(strip(page).locator('[data-slot="attendance-early"]')).toContainText("Waiting");

  const owner = await ownerPage(browser, info);
  await owner.goto("/approvals");
  const row = owner.locator('[data-slot="approval-row"][data-group="early-leave"]', {
    hasText: "Family function",
  });
  await row.getByRole("button", { name: "Stay" }).click();
  await expect(owner.getByText(/was asked to stay/)).toBeVisible();
  await expect.poll(async () => (await requestOf(email))?.state).toBe("stay");
  await owner.context().close();

  await page.reload();
  await expect(strip(page).locator('[data-slot="attendance-early"]')).toContainText(
    /The Owner asked you to stay until .+\. You'll be reminded then\./,
  );
  await expect(strip(page).getByRole("button", { name: "Ask to leave early" })).toBeVisible();
});

test("no answer in 30 minutes: End day, Left early (not answered), and the Owner corrects it", async ({
  page,
  browser,
}, info) => {
  const email = person("leave", info);
  await hoursAround(5, 120);
  await startedPerson(page, email);
  const requestId = await rpcAs<string>(email, PASSWORD, "attendance_ask_leave_early", {
    reason: "Bank before it shuts",
  });
  // The wait has passed: the request was made 31 minutes ago.
  await serviceUpdate(`early_leave_requests?id=eq.${requestId}`, {
    requested_at: new Date(systemClock().getTime() - 31 * 60_000).toISOString(),
  });
  await page.reload();
  await expect(strip(page).locator('[data-slot="attendance-early"]')).toContainText(
    /No answer yet: you can end your day\. It's marked "Left early, not answered"\./,
  );
  await strip(page).getByRole("button", { name: "End day" }).click();
  const confirm = page.getByRole("alertdialog", { name: "End your day?" });
  await confirm.getByRole("button", { name: "End day" }).click();
  await expect(confirm).toBeHidden();
  await expect.poll(async () => (await requestOf(email))?.state).toBe("left_unanswered");

  const owner = await ownerPage(browser, info);
  await owner.goto("/approvals");
  const row = owner.locator('[data-slot="approval-row"][data-group="early-leave-unanswered"]', {
    hasText: "Bank before it shuts",
  });
  await expect(row).toContainText(/ended \d{1,2}:\d{2} [ap]m/);
  await row.getByRole("button", { name: "Correct…" }).click();
  const dialog = owner.getByRole("dialog", { name: /^Correct .+'s day$/ });
  await dialog.getByLabel("Reason").fill("Left at four, half the day worked");
  await dialog.getByRole("button", { name: "Save correction" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await requestOf(email))?.state).toBe("corrected");
  await owner.context().close();
});

test("Stay until behind a person's row on the board: set, then back to the end time", async ({
  page,
  browser,
}, info) => {
  const email = person("half", info);
  const { end } = await hoursAround(5, 30);
  await startedPerson(page, email);
  const owner = await ownerPage(browser, info);
  await owner.goto("/today/people");
  await hydrated(owner);
  const name = (
    await serviceSelect<{ full_name: string }>(
      `members?email=eq.${encodeURIComponent(email)}&select=full_name`,
    )
  )[0]!.full_name;
  await owner.getByRole("button", { name: `Stay until for ${name}` }).click();
  const sheet = owner.locator('[data-slot="stay-until-sheet"]');
  await expect(sheet).toContainText(`${name} · Stay until`);
  await expect(sheet).toContainText(`Their day ends at ${wall(end)}. They'll be told right away.`);
  await expect(sheet.getByRole("button", { name: `Keep ${wall(end)}` })).toBeVisible();
  await expectFits(owner, sheet, info);
  const until = end + Math.min(30, LAST_MINUTE - end);
  await sheet.getByLabel("Stay until").fill(hhmm(until));
  await sheet.getByRole("button", { name: `Set ${wall(until)}` }).click();
  await expect(sheet).toBeHidden();
  await expect.poll(async () => (await dayOf(email))?.stay_until).not.toBeNull();
  const row = owner.locator("li", {
    has: owner.locator('[data-slot="board-row"]', { hasText: name }),
  });
  await expect(row).toContainText(`Stay until ${wall(until)}`);

  // The person reads it in the strip.
  await page.reload();
  await expect(strip(page).locator('[data-slot="attendance-end-line"]')).toContainText(
    `The Owner asked you to stay until ${wall(until)}`,
  );

  await owner.getByRole("button", { name: `Stay until for ${name}` }).click();
  await sheet.locator('[data-slot="stay-until-clear"]').click();
  await expect(sheet).toBeHidden();
  await expect.poll(async () => (await dayOf(email))?.stay_until ?? null).toBeNull();
  await owner.context().close();
});

test("the Owner's Today: the Late line (amber), and the month counts", async ({
  page,
  browser,
}, info) => {
  const email = person("staff", info);
  await resetAttendanceAndLeaveOf(email);
  await hoursAround(40, 120);
  await rpcAs(email, PASSWORD, "attendance_start_day", {});
  await rpcAs(email, PASSWORD, "attendance_late_reason", { reason: "Traffic" });
  void page;
  const owner = await ownerPage(browser, info);
  await owner.goto("/today");
  const late = owner.locator('[data-slot="today-hours-line"][data-line="late"]');
  await expect(late).toHaveText(/^\d+ started late today$/);
  await expect(late).toHaveAttribute("data-tone", "attention");

  // The month counts (owner 2026-10-22): the Month report's row and the person's Month tab.
  const name = (
    await serviceSelect<{ full_name: string }>(
      `members?email=eq.${encodeURIComponent(email)}&select=full_name`,
    )
  )[0]!.full_name;
  await owner.goto("/reports/month");
  const row = owner.locator('[data-slot="team-month-row"]', { hasText: name });
  await expect(row.locator('[data-count="late"]')).toContainText(/Late\s*[1-9]/);
  await expect(row.locator('[data-count="unanswered"]')).toContainText("Left early, not answered");
  await expect(row.locator('[data-count="half"]')).toContainText("Half days");
  await expectNoHorizontalScroll(owner);
  await owner.goto(`/people/${await memberIdOf(email)}/month`);
  const line = owner.locator('[data-slot="month-line"][data-line="hours-late"]');
  await expect(line).toContainText(/Late days/);
  await expect(line).toContainText(/min in all/);
  await expect(owner.locator('[data-line="hours-unanswered"]')).toContainText(
    "Left early, not answered",
  );
  await expect(owner.locator('[data-line="hours-approved"]')).toContainText(
    "Early leaves approved",
  );
  await owner.context().close();
});

test("Morning or afternoon: Choose leave's half day and the leave form's", async ({
  page,
}, info) => {
  const email = person("half", info);
  await resetAttendanceAndLeaveOf(email);
  await hoursAround(5, 120);
  await signIn(page, email, PASSWORD, { day: "stop" });
  const prompt = startPrompt(page);
  await prompt.getByRole("button", { name: "On leave today? Choose leave" }).click();
  await prompt.getByRole("radio", { name: /^Half day\b/ }).check();
  const halves = prompt.locator('[data-slot="half-choice"]');
  await expect(halves).toContainText("Which half?");
  await expect(halves.getByRole("radio", { name: /Morning off/ })).toBeChecked();
  await expect(halves).toContainText("Start your day after lunch. You won't be marked late");
  await expect(halves).toContainText("End your day after lunch. No need to ask to leave early");
  await halves.getByRole("radio", { name: /Afternoon off/ }).check();
  await expectFits(page, prompt, info);
  await prompt.getByRole("button", { name: "Record leave" }).click();
  await expect(prompt).toBeHidden();
  const id = await memberIdOf(email);
  await expect
    .poll(async () =>
      (
        await serviceSelect<{ half: string | null }>(
          `leave_requests?member_id=eq.${id}&type=eq.half_day&select=half`,
        )
      ).map((row) => row.half),
    )
    .toEqual(["afternoon"]);

  // The leave form: a new half day asks which half too.
  await page.goto("/leave");
  await hydrated(page);
  await page.getByRole("button", { name: "Request leave" }).first().click();
  const form = page.getByRole("dialog");
  await form.getByRole("combobox", { name: "Kind of leave" }).click();
  await page.getByRole("option", { name: "Half day", exact: true }).click();
  await expect(form.locator('[data-slot="half-choice"]')).toContainText("Which half?");
  await expect(form.getByRole("button", { name: "Request half day" })).toBeVisible();
  await expectFits(page, form, info);
});

test("Settings → Thresholds: the Working day and Approvals fields", async ({ browser }, info) => {
  await hoursAround(0, 480);
  const owner = await ownerPage(browser, info);
  await owner.goto("/settings/thresholds");
  await expect(owner.locator('[data-slot="threshold-group"]')).toHaveCount(5);
  await owner.locator('[data-slot="threshold-group"]#working-day summary').click();
  await owner.locator('[data-slot="threshold-group"]#approvals summary').click();
  await expect(owner.locator('[data-slot="working-hours-switch"] input')).toBeChecked();
  const late = owner.getByLabel("Late after (minutes)");
  await expect(late).toHaveValue("15");
  await owner.getByLabel("Work starts").fill("10:00");
  await late.fill("20");
  await expect(owner.getByText("Started at 10:21 am counts as late")).toBeVisible();
  await owner.getByLabel("No answer to an early leave after (minutes)").fill("45");
  await owner.getByLabel("Urgent tasks: remind every (minutes)").fill("90");
  await owner.getByRole("button", { name: "Add a time" }).click();
  await owner.getByLabel("High-priority reminder 4").fill("16:00");
  // The end before the start is refused, said under the field.
  await owner.getByLabel("Work ends").fill("09:00");
  await owner.getByRole("button", { name: "Save thresholds" }).click();
  await expect(owner.locator('[data-slot="field-error"]')).toContainText(
    "Work has to end after it starts.",
  );
  await owner.getByLabel("Work ends").fill("18:00");
  await owner.getByRole("button", { name: "Save thresholds" }).click();
  await expect(owner.getByText("Thresholds saved")).toBeVisible();
  const [saved] = await serviceSelect<{
    late_grace_minutes: number;
    early_leave_wait_minutes: number;
    approval_reminder_urgent_minutes: number;
    approval_reminder_high_times: string[];
  }>(
    "org_settings?select=late_grace_minutes,early_leave_wait_minutes,approval_reminder_urgent_minutes,approval_reminder_high_times",
  );
  expect(saved?.late_grace_minutes).toBe(20);
  expect(saved?.early_leave_wait_minutes).toBe(45);
  expect(saved?.approval_reminder_urgent_minutes).toBe(90);
  expect(saved?.approval_reminder_high_times).toEqual([
    "11:00:00",
    "14:00:00",
    "16:00:00",
    "17:00:00",
  ]);
  await serviceUpdate("org_settings?org_id=not.is.null", {
    approval_reminder_urgent_minutes: 60,
    approval_reminder_high_times: ["11:00", "14:00", "17:00"],
  });
  await owner.context().close();
});

test("the switch off: Start day and End day are today's, no Late, no ask", async ({
  page,
}, info) => {
  const email = person("admin", info);
  await resetAttendanceAndLeaveOf(email);
  await hoursAround(40, 120);
  await serviceUpdate("org_settings?org_id=not.is.null", { working_hours_on: false });
  await signIn(page, email, PASSWORD, { day: "stop" });
  const prompt = startPrompt(page);
  await prompt.getByRole("button", { name: "Just looking" }).click();
  await expect(strip(page).locator('[data-slot="attendance-status"]')).toHaveText("Start your day");
  await strip(page)
    .getByRole("button", { name: /^Start day/ })
    .click();
  await expect(page.locator('[data-slot="late-sheet"]')).toHaveCount(0);
  await expect(strip(page).getByRole("button", { name: "End day" })).toBeVisible();
  await expect(strip(page).locator('[data-slot="attendance-hours"]')).toHaveCount(0);
  expect((await dayOf(email))?.late_minutes ?? null).toBeNull();
});

test.describe("installed (ARCHITECTURE §14.2): the new sheets close one per back", () => {
  test("the late sheet, the ask sheet and Stay until", async ({ page, browser }, info) => {
    test.skip(!isPhone(info), "the installed app is a phone");
    const email = person("staff", info);
    await resetAttendanceAndLeaveOf(email);
    await hoursAround(40, 120);
    await runInstalled(page);
    await signIn(page, email, PASSWORD, { day: "stop" });
    await startPrompt(page).getByRole("button", { name: "Just looking" }).click();
    await expect(startPrompt(page)).toBeHidden();
    await strip(page)
      .getByRole("button", { name: /^Start day/ })
      .click();
    const late = page.locator('[data-slot="late-sheet"]');
    await expect(late).toBeVisible();
    await expectBackStack(page, [{ closes: late, url: /\/my-day$/ }]);
    expect((await dayOf(email))?.started_at ?? null).toBeNull();

    // Started: the ask sheet, back closes it and sends nothing.
    await hoursAround(5, 120);
    await rpcAs(email, PASSWORD, "attendance_start_day", {});
    await page.reload();
    await hydrated(page);
    await strip(page).getByRole("button", { name: "Ask to leave early" }).click();
    const ask = page.locator('[data-slot="ask-leave-early-sheet"]');
    await expect(ask).toBeVisible();
    await expectBackStack(page, [{ closes: ask, url: /\/my-day$/ }]);
    expect(await requestOf(email)).toBeUndefined();

    const owner = await ownerPage(browser, info);
    await runInstalled(owner);
    await owner.goto("/today");
    await owner.goto("/today/people");
    await hydrated(owner);
    await owner
      .getByRole("button", { name: /^Stay until for / })
      .first()
      .click();
    const stay = owner.locator('[data-slot="stay-until-sheet"]');
    await expect(stay).toBeVisible();
    await expectBackStack(owner, [{ closes: stay, url: /\/today\/people$/ }, { url: /\/today$/ }]);
    await owner.context().close();
  });
});
