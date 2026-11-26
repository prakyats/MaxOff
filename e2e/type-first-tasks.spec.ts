import { type Locator, type Page, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { addISTDays, formatIST, istInstant, istWeekday, todayIST } from "../src/core/time";

import {
  addTaskPeople,
  animationsSettled,
  chooseTaskType,
  closePeoplePicker,
  expectSheetAboveKeyboard,
  holdReads,
  memberIdOf,
  openPeoplePicker,
  ownSession,
  pageHeader,
  pickerRow,
  removeTasksTitled,
  rpcAs,
  serviceDelete,
  serviceInsert,
  serviceSelect,
  signIn,
  storageStateFor,
  taskTypeId,
  USERS,
} from "./helpers";

/**
 * New task, type first, with "Who's on it?" (v6.0 "Admin calendar", unit 12; PRODUCT §4.6,
 * WORKFLOWS §3.1 "The form as built (v6.0)"): what `tasks.spec.ts` does not already prove of the
 * form and its people picker. As an Admin and as the Owner: the type's list and what each type
 * asks; Free then / Busy then with a timed clash, an all-day clash, a full day of leave and a
 * half day, each naming only the type, the time and who booked it; the list following the time;
 * "Done by" following the end of the event until it is set by hand; the task made with its event,
 * deadline, people and recorded warning; Edit with the same form; a deadline's single list; the
 * list's loading, failed and empty states; and, on a phone, the sheet above the keyboard.
 *
 * Its name ends in `tasks.spec.ts` so the three projects run it as they run `tasks.spec.ts`
 * (`TASKS_SPECS`, playwright.config.ts). The people are that spec's, one set per project; each
 * test has its own IST day, about two years on where no other spec puts a task (a person's day
 * is counted whole: "1 task already due"), and its own prefix, and removes only its own tasks and
 * leave, so the tests run in parallel with `tasks.spec.ts` and re-run without `pnpm db:reset`. Leave is put on the
 * Coordinator and the Helper, never on "Away", whose leave `tasks.spec.ts` resets.
 */

const PASSWORD = "task-local-password";
const LABELS = { staff: "Staff", helper: "Helper", away: "Away", coord: "Coordinator" } as const;
type Kind = keyof typeof LABELS;

function person(kind: Kind, info: TestInfo) {
  return {
    email: `task-${kind}-${info.project.name}@maxoff.local`,
    name: `Test Task ${LABELS[kind]} (${info.project.name})`,
  };
}

function admin(info: TestInfo) {
  return {
    email: `task-admin-${info.project.name}@maxoff.local`,
    name: `Test Task Admin (${info.project.name})`,
  };
}

/** A weekday (Mon–Fri) at least `offset` days from today, IST. */
function workingDay(offset: number): string {
  let day = addISTDays(todayIST(), offset);
  while (istWeekday(day) === 0 || istWeekday(day) === 6) day = addISTDays(day, 1);
  return day;
}

/** "Tue 15 Dec", as the form and the picker say a day. */
function dayWords(day: string): string {
  return formatIST(`${day}T12:00:00+05:30`, "EEE d MMM");
}

type EventArgs = {
  by: { email: string; password: string };
  title: string;
  type: string;
  memberId: string;
  day: string;
  /** Left out: a date-only event, busy all day. */
  window?: { start: string; end: string };
  due?: string;
};

/** Arranges an event through `task_create` as that person (who then "booked" it). */
async function books(args: EventArgs): Promise<string> {
  return rpcAs<string>(args.by.email, args.by.password, "task_create", {
    title: args.title,
    description: null,
    task_type_id: await taskTypeId(args.type),
    client_id: null,
    priority: "medium",
    due_at: istInstant(args.day, args.due ?? "20:00"),
    assignee_ids: [args.memberId],
    primary_owner_id: args.memberId,
    approving_admin_id: null,
    stages: [],
    event_date: args.day,
    event_start_at: args.window ? istInstant(args.day, args.window.start) : null,
    event_end_at: args.window ? istInstant(args.day, args.window.end) : null,
  });
}

/** Approved leave that day, as the Owner would have decided it. */
async function onLeave(memberId: string, day: string, type: "leave" | "half_day"): Promise<void> {
  await serviceInsert("leave_requests", {
    member_id: memberId,
    type,
    start_date: day,
    end_date: day,
    state: "approved",
    source: "owner",
    decided_by: await memberIdOf(USERS.owner.email),
    decided_at: `${todayIST()}T00:00:00+05:30`,
  });
}

async function removeLeaveOn(memberIds: string[], day: string): Promise<void> {
  await serviceDelete(
    `leave_requests?member_id=in.(${memberIds.join(",")})&start_date=eq.${day}&end_date=eq.${day}`,
  );
}

function formDialog(page: Page): Locator {
  return page.locator('[data-slot="task-form-dialog"]');
}

/** The form's own fields, by their exact labels ("To" is also inside people's names). */
function field(dialog: Locator, label: "When" | "From" | "To" | "Deadline" | "Time (IST)") {
  return dialog.locator('[data-slot="task-fields"]').getByLabel(label, { exact: true });
}

/** Reads "Who's on it?" where the screen has it, then closes the phone's sheet again. */
async function inPicker(
  page: Page,
  dialog: Locator,
  read: (picker: Locator) => Promise<void>,
): Promise<void> {
  const picker = await openPeoplePicker(page, dialog);
  await expect(picker.locator('[data-slot="picker-list"]')).not.toHaveAttribute(
    "aria-busy",
    "true",
  );
  await read(picker);
  await closePeoplePicker(page);
}

const TASK_URL = /\/tasks\/[0-9a-f-]{36}$/;
const OWNER = { email: USERS.owner.email, password: USERS.owner.password };
/** The seeded Owner's name, as the picker lists them. */
const OWNER_NAME = "Prishit Shetty";
const LOCAL_ADMIN = {
  email: USERS.admin.email,
  password: USERS.admin.password,
  name: "Local Admin",
};

test.describe("New task, type first: the flows", () => {
  // The flows prove behaviour, which 55px of width does not change: 1280 and 375px only.
  test.skip(({ viewport }) => viewport?.width === 430, "flows run at 1280 and 375px");

  test.describe("as an Admin", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("the type decides the form; Free then and Busy then say who booked what and follow the time; Done by follows the event until changed", async ({
      page,
    }, info) => {
      const prefix = `Type first ${info.project.name} `;
      const day = workingDay(707);
      const [staff, helper, away, coord] = (["staff", "helper", "away", "coord"] as const).map(
        (kind) => person(kind, info),
      ) as [
        ReturnType<typeof person>,
        ReturnType<typeof person>,
        ReturnType<typeof person>,
        ReturnType<typeof person>,
      ];
      const [staffId, helperId, awayId, coordId] = await Promise.all(
        [staff, helper, away, coord].map((who) => memberIdOf(who.email)),
      );
      await removeTasksTitled(prefix);
      await removeLeaveOn([helperId as string, coordId as string], day);
      // A shoot 2–4 pm the Owner booked, a meeting with no time another Admin booked, a full day
      // of leave and a half day.
      await books({
        by: OWNER,
        title: `${prefix}secret shoot`,
        type: "Shoot / Site Visit",
        memberId: staffId as string,
        day,
        window: { start: "14:00", end: "16:00" },
      });
      await books({
        by: LOCAL_ADMIN,
        title: `${prefix}secret meeting`,
        type: "Meeting",
        memberId: awayId as string,
        day,
      });
      await onLeave(coordId as string, day, "leave");
      await onLeave(helperId as string, day, "half_day");

      await signIn(page, admin(info).email, PASSWORD);
      await page.goto("/tasks");
      await page.getByRole("button", { name: "New task" }).click();
      const dialog = formDialog(page);
      const create = dialog.getByRole("button", { name: "Create task" });

      // Type first: one question, its hint, and nothing to fill in or send until it is answered.
      const type = dialog.locator('[data-field="task-type"]');
      await expect(type).toHaveText("Choose a type");
      await expect(dialog).toContainText(
        "First, so the form asks only what this kind of task needs.",
      );
      await expect(dialog.getByLabel("Title")).toBeDisabled();
      await expect(create).toBeDisabled();
      await expect(dialog.locator('[data-slot="task-assignees"]')).toHaveCount(0);
      await expect(dialog.locator('[data-slot="task-more-options"]')).toHaveCount(0);

      // The list: each type with what it asks for, read from the type's own settings.
      await type.click();
      const option = (name: string) =>
        page.getByRole("option", { name: new RegExp(`^${name}(\\s|$)`) }).first();
      await expect(option("Normal")).toContainText("a deadline");
      await expect(option("Shoot / Site Visit")).toContainText(
        "date, time, place · on the calendar",
      );
      await expect(option("Posting")).toContainText("date and time · on the calendar");
      await expect(page.locator('[data-slot="task-type-note"]:visible')).toHaveText(
        "Types come from Settings → Task types. A new type shows here by itself.",
      );
      await option("Meeting").click();
      await expect(type).toHaveText("Meeting");

      // An event: When / From / To and Where, no deadline to type.
      await expect(field(dialog, "Deadline")).toHaveCount(0);
      await expect(dialog.getByLabel("Where")).toBeVisible();
      await expect(dialog.getByLabel("Client (label)")).toBeVisible();
      await dialog.getByLabel("Title").fill(`${prefix}plan`);
      await field(dialog, "When").fill(day);
      await field(dialog, "From").fill("15:00");
      await field(dialog, "To").fill("17:00");
      const doneBy = dialog.locator('[data-slot="task-done-by"]');
      await expect(doneBy).toContainText(`Done by ${dayWords(day)}, 5:00 pm`);
      await expect(doneBy).toContainText("the end of the meeting");
      await expect(doneBy).toHaveAttribute("data-follows", "");

      await inPicker(page, dialog, async (picker) => {
        await expect(page.locator('[data-slot="people-subtitle"]:visible')).toHaveText(
          `Meeting · ${dayWords(day)} · 3:00 pm – 5:00 pm`,
        );
        const busy = picker.locator('[data-slot="picker-busy"]');
        const free = picker.locator('[data-slot="picker-free"]');
        await expect(busy.getByRole("heading")).toContainText("Busy then");
        await expect(free.getByRole("heading")).toContainText("Free then");
        // A timed clash: the type, the time and who booked it; never the task's title.
        await expect(pickerRow(busy, staff.name)).toContainText(
          "Shoot / Site Visit 2:00 pm – 4:00 pm · booked by Owner",
        );
        await expect(pickerRow(busy, staff.name).locator('[data-slot="picker-chip"]')).toHaveText(
          "Clashes",
        );
        // A date-only booking is busy all day; another Admin booked it, by their full name.
        await expect(pickerRow(busy, away.name)).toContainText(
          `Meeting all day · booked by ${LOCAL_ADMIN.name}`,
        );
        await expect(pickerRow(busy, away.name).locator('[data-slot="picker-chip"]')).toHaveText(
          "Clashes",
        );
        // A full day of leave: Busy then, said as a fact, with its own chip and no reason.
        await expect(pickerRow(busy, coord.name)).toContainText("On leave that day");
        await expect(pickerRow(busy, coord.name).locator('[data-slot="picker-chip"]')).toHaveText(
          "On leave",
        );
        // A half day stays under Free then, with its note and no chip.
        await expect(pickerRow(free, helper.name)).toContainText("Half day that day");
        await expect(pickerRow(free, helper.name).locator('[data-slot="picker-chip"]')).toHaveCount(
          0,
        );
        await expect(pickerRow(busy, helper.name)).toHaveCount(0);
        // The Owner is offered (6b.2) but never listed as Free (PERMISSIONS §2, v6.0): with
        // nothing booked, in their own Owner group after Busy then, with no line at all.
        const owner = picker.locator('[data-slot="picker-owner"]');
        await expect(owner.getByRole("heading")).toContainText("Owner");
        await expect(pickerRow(owner, OWNER_NAME)).toHaveCount(1);
        await expect(pickerRow(owner, OWNER_NAME).locator('[data-slot="picker-line"]')).toHaveCount(
          0,
        );
        await expect(pickerRow(owner, OWNER_NAME)).not.toContainText("Free");
        await expect(pickerRow(free, OWNER_NAME)).toHaveCount(0);
        await expect(pickerRow(busy, OWNER_NAME)).toHaveCount(0);
        await expect(picker).not.toContainText("secret");
      });

      // The list follows the time: after the shoot ends its person is free, with the shoot said
      // as earlier that day; an all-day booking still clashes. Done by follows the new end.
      await field(dialog, "From").fill("16:30");
      await field(dialog, "To").fill("18:00");
      await expect(doneBy).toContainText(`Done by ${dayWords(day)}, 6:00 pm`);
      await inPicker(page, dialog, async (picker) => {
        await expect(page.locator('[data-slot="people-subtitle"]:visible')).toHaveText(
          `Meeting · ${dayWords(day)} · 4:30 pm – 6:00 pm`,
        );
        const busy = picker.locator('[data-slot="picker-busy"]');
        const free = picker.locator('[data-slot="picker-free"]');
        await expect(pickerRow(free, staff.name)).toContainText(
          "Free · earlier: Shoot / Site Visit 2:00 pm – 4:00 pm · booked by Owner",
        );
        await expect(pickerRow(busy, staff.name)).toHaveCount(0);
        await expect(pickerRow(busy, away.name)).toContainText("Meeting all day");
      });

      // Change: the deadline's own fields, starting from the event's end. Set by hand, it no
      // longer follows the event.
      await expect(field(dialog, "Deadline")).toHaveCount(0);
      await doneBy.getByRole("button", { name: "Change" }).click();
      await expect(field(dialog, "Deadline")).toHaveValue(day);
      await expect(field(dialog, "Time (IST)")).toHaveValue("18:00");
      await field(dialog, "Time (IST)").fill("19:00");
      await expect(doneBy).toContainText(`Done by ${dayWords(day)}, 7:00 pm`);
      await expect(doneBy).not.toContainText("the end of");
      await expect(doneBy).not.toHaveAttribute("data-follows", "");
      await field(dialog, "To").fill("17:30");
      await expect(doneBy).toContainText(`Done by ${dayWords(day)}, 7:00 pm`);

      // The people chosen are chips with what the list said of them; someone on leave or busy
      // can be picked, and the warning is kept and recorded as before. A clash says the booking
      // as the picker does: its type, its time (all day) and who booked it, by full name.
      await addTaskPeople(page, dialog, [staff.name, coord.name, away.name]);
      const chip = (id: string) =>
        dialog.locator(`[data-slot="task-assignee"][data-member="${id}"]`);
      await expect(chip(staffId as string)).toContainText("Free");
      await expect(chip(staffId as string)).toContainText("Primary owner");
      await expect(chip(coordId as string)).toContainText("On leave");
      await expect(
        dialog.locator(
          `[data-slot="task-warning"][data-member="${coordId}"][data-kind="on_leave"]`,
        ),
      ).toHaveCount(1);
      await expect(chip(awayId as string)).toContainText("Clashes");
      await expect(
        dialog.locator(`[data-slot="task-warning"][data-member="${awayId}"][data-kind="overlap"]`),
      ).toHaveText(`${away.name}: Clashes: Meeting all day · booked by ${LOCAL_ADMIN.name}`);
      await expect(dialog.locator('[data-slot="task-warning"]')).toHaveCount(2);

      await create.click();
      await expect(page).toHaveURL(TASK_URL);
      await expect(pageHeader(page)).toContainText(`${prefix}plan`);
      const taskId = new URL(page.url()).pathname.split("/").at(-1) as string;
      const [made] = await serviceSelect<Record<string, string | null>>(
        `tasks?id=eq.${taskId}&select=event_date,event_start_at,event_end_at,due_at,primary_owner_id,task_type_id`,
      );
      expect(made?.task_type_id).toBe(await taskTypeId("Meeting"));
      expect(made?.event_date).toBe(day);
      expect(Date.parse(made?.event_start_at ?? "")).toBe(Date.parse(istInstant(day, "16:30")));
      expect(Date.parse(made?.event_end_at ?? "")).toBe(Date.parse(istInstant(day, "17:30")));
      expect(Date.parse(made?.due_at ?? "")).toBe(Date.parse(istInstant(day, "19:00")));
      expect(made?.primary_owner_id).toBe(staffId);
      const onIt = await serviceSelect<{ member_id: string }>(
        `task_assignees?task_id=eq.${taskId}&removed_at=is.null&select=member_id`,
      );
      expect(onIt.map((row) => row.member_id).sort()).toEqual([staffId, coordId, awayId].sort());
      // Both kept warnings are recorded; the all-day clash with only what task_create accepts.
      expect(
        await serviceSelect<{ kind: string; member_id: string; details: Record<string, unknown> }>(
          `task_warnings?task_id=eq.${taskId}&select=kind,member_id,details&order=kind`,
        ),
      ).toEqual([
        { kind: "on_leave", member_id: coordId, details: { date: day, leave: "leave" } },
        { kind: "overlap", member_id: awayId, details: { date: day } },
      ]);
    });

    test("Edit task is the same form: the type, the event and the people as they stand; the task's own booking is no clash with itself", async ({
      page,
    }, info) => {
      const prefix = `Type edit ${info.project.name} `;
      const day = workingDay(714);
      const staff = person("staff", info);
      const helper = person("helper", info);
      const me = { email: admin(info).email, password: PASSWORD };
      const [staffId, helperId] = await Promise.all([
        memberIdOf(staff.email),
        memberIdOf(helper.email),
      ]);
      await removeTasksTitled(prefix);
      const taskId = await books({
        by: me,
        title: `${prefix}review`,
        type: "Meeting",
        memberId: staffId,
        day,
        window: { start: "10:00", end: "11:00" },
        due: "11:00",
      });
      await books({
        by: OWNER,
        title: `${prefix}secret shoot`,
        type: "Shoot / Site Visit",
        memberId: staffId,
        day,
        window: { start: "14:00", end: "16:00" },
      });
      await books({
        by: me,
        title: `${prefix}secret call`,
        type: "Meeting",
        memberId: helperId,
        day,
        window: { start: "10:30", end: "11:30" },
      });

      await signIn(page, me.email, PASSWORD);
      await page.goto(`/tasks/${taskId}`);
      await page.getByRole("button", { name: "Task actions" }).click();
      await page.getByRole("menuitem", { name: "Edit task" }).click();
      const dialog = formDialog(page);
      await expect(dialog.getByRole("heading", { name: "Edit task" })).toBeVisible();
      await expect(dialog.locator('[data-field="task-type"]')).toHaveText("Meeting");
      await expect(dialog.getByLabel("Title")).toHaveValue(`${prefix}review`);
      await expect(field(dialog, "When")).toHaveValue(day);
      await expect(field(dialog, "From")).toHaveValue("10:00");
      await expect(field(dialog, "To")).toHaveValue("11:00");
      const doneBy = dialog.locator('[data-slot="task-done-by"]');
      await expect(doneBy).toContainText(`Done by ${dayWords(day)}, 11:00 am`);
      await expect(doneBy).toContainText("the end of the meeting");
      await expect(
        dialog.locator(`[data-slot="task-assignee"][data-member="${staffId}"]`),
      ).toContainText(staff.name);

      await inPicker(page, dialog, async (picker) => {
        const busy = picker.locator('[data-slot="picker-busy"]');
        const free = picker.locator('[data-slot="picker-free"]');
        // The person already on it is free: this task's own hour is not said against it.
        await expect(pickerRow(free, staff.name)).toContainText(
          "Free · later: Shoot / Site Visit 2:00 pm – 4:00 pm · booked by Owner",
        );
        await expect(pickerRow(free, staff.name)).not.toContainText("10:00 am");
        await expect(pickerRow(free, staff.name).getByRole("checkbox")).toBeChecked();
        await expect(pickerRow(busy, helper.name)).toContainText(
          "Meeting 10:30 am – 11:30 am · booked by you",
        );
        await expect(picker).not.toContainText("secret");
      });

      // A later end: the deadline follows it, and the save is an ordinary edit.
      await field(dialog, "To").fill("12:00");
      await expect(doneBy).toContainText(`Done by ${dayWords(day)}, 12:00 pm`);
      await dialog.getByRole("button", { name: "Save changes" }).click();
      await expect(dialog).toBeHidden();
      const [saved] = await serviceSelect<Record<string, string | null>>(
        `tasks?id=eq.${taskId}&select=event_end_at,due_at`,
      );
      expect(Date.parse(saved?.event_end_at ?? "")).toBe(Date.parse(istInstant(day, "12:00")));
      expect(Date.parse(saved?.due_at ?? "")).toBe(Date.parse(istInstant(day, "12:00")));
    });
  });

  test.describe("as the Owner", () => {
    test.use({ storageState: storageStateFor("owner") });

    test("a deadline only: one list with each person's day and no Clashes; the list says when it is reading, finds nobody, or could not be read", async ({
      page,
    }, info) => {
      const prefix = `Type day ${info.project.name} `;
      const day = workingDay(721);
      const staff = person("staff", info);
      const helper = person("helper", info);
      const coord = person("coord", info);
      const [staffId, helperId, coordId] = await Promise.all(
        [staff, helper, coord].map((who) => memberIdOf(who.email)),
      );
      await removeTasksTitled(prefix);
      await removeLeaveOn([coordId as string], day);
      await books({
        by: OWNER,
        title: `${prefix}secret shoot`,
        type: "Shoot / Site Visit",
        memberId: staffId as string,
        day,
        window: { start: "14:00", end: "16:00" },
        due: "18:00",
      });
      await onLeave(coordId as string, day, "leave");

      await page.goto("/tasks");
      await page.getByRole("button", { name: "New task" }).click();
      const dialog = formDialog(page);
      await chooseTaskType(page, dialog, "Normal");
      // A type with no event: one deadline, and none of the event's fields.
      for (const label of ["When", "From", "To"] as const) {
        await expect(field(dialog, label)).toHaveCount(0);
      }
      await expect(dialog.getByLabel("Where")).toHaveCount(0);
      await expect(dialog.locator('[data-slot="task-done-by"]')).toHaveCount(0);

      // Before a day is known everyone is listed, with nothing claimed about their day.
      await inPicker(page, dialog, async (picker) => {
        await expect(page.locator('[data-slot="people-subtitle"]:visible')).toHaveText(
          "Normal · pick the deadline to see their day",
        );
        await expect(pickerRow(picker, staff.name)).toBeVisible();
        await expect(
          pickerRow(picker, staff.name).locator('[data-slot="picker-line"]'),
        ).toHaveCount(0);
      });

      // Reading: the rows keep their place and say nothing yet.
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/tasks/availability**", async (route) => {
        await held;
        await route.continue();
      });
      await field(dialog, "Deadline").fill(day);
      const reading = await openPeoplePicker(page, dialog);
      await expect(reading.locator('[data-slot="picker-list"]')).toHaveAttribute(
        "aria-busy",
        "true",
      );
      await expect(pickerRow(reading, staff.name)).toBeVisible();
      await expect(pickerRow(reading, staff.name).locator('[data-slot="picker-line"]')).toHaveCount(
        0,
      );
      const answered = page.waitForResponse(/\/api\/tasks\/availability/);
      release();
      await answered;
      await page.unroute("**/api/tasks/availability**");
      await closePeoplePicker(page);

      await inPicker(page, dialog, async (picker) => {
        // One list: no Free then or Busy then, and never a Clashes chip.
        await expect(picker.locator('[data-slot="picker-day"]')).toBeVisible();
        await expect(picker.locator('[data-slot="picker-free"]')).toHaveCount(0);
        await expect(picker.locator('[data-slot="picker-busy"]')).toHaveCount(0);
        await expect(picker.locator('[data-slot="picker-chip"]')).toHaveCount(0);
        await expect(pickerRow(picker, staff.name)).toContainText(
          "Shoot / Site Visit 2:00 pm – 4:00 pm · booked by you",
        );
        await expect(pickerRow(picker, staff.name)).toContainText("1 task already due");
        await expect(pickerRow(picker, coord.name)).toContainText("On leave that day");
        await expect(pickerRow(picker, helper.name)).toContainText("Nothing that day");
        await expect(picker).not.toContainText("secret");

        // A search that finds nobody says so, and clearing it brings the list back.
        await picker.getByLabel("Find a person").fill("zzzz nobody");
        await expect(picker.locator('[data-slot="picker-empty"]')).toHaveText(
          "Nobody called “zzzz nobody”.",
        );
        await expect(picker.locator('[data-slot="picker-row"]')).toHaveCount(0);
        await picker.getByLabel("Find a person").fill("");
        await expect(pickerRow(picker, helper.name)).toBeVisible();
      });

      // Their day could not be read: the list says so, and people are picked all the same.
      await page.route("**/api/tasks/availability**", (route) => route.abort());
      await field(dialog, "Deadline").fill(addISTDays(day, 7));
      const failed = await openPeoplePicker(page, dialog);
      await expect(failed.locator('[data-slot="picker-failed"]')).toHaveText(
        "Their day could not be checked. You can still pick people.",
      );
      await expect(pickerRow(failed, helper.name).locator('[data-slot="picker-line"]')).toHaveCount(
        0,
      );
      await closePeoplePicker(page);
      await addTaskPeople(page, dialog, [helper.name]);
      await expect(
        dialog.locator(`[data-slot="task-assignee"][data-member="${helperId}"]`),
      ).toContainText(helper.name);
      await expect(dialog.locator('[data-slot="task-check-failed"]')).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Create task" })).toBeEnabled();
    });
  });
});

test.describe("Who's on it? on a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "the sheet is the phone's, 375 and 430");
  test.use({ storageState: storageStateFor("owner") });

  test("the sheet keeps its height while a search narrows the list, ends above the keyboard, and its Done only closes it", async ({
    page,
  }, info) => {
    const staff = person("staff", info);
    await page.goto("/tasks");
    await page.getByRole("button", { name: "New task" }).click();
    const dialog = formDialog(page);
    await chooseTaskType(page, dialog, "Shoot / Site Visit");
    await dialog.getByLabel("Title").fill("Keyboard draft");
    const picker = await openPeoplePicker(page, dialog);
    const sheet = page.locator('[data-slot="people-sheet"]');
    await expect(sheet.getByRole("heading", { name: "Who's on it?" })).toBeVisible();

    const heightOf = async () => Math.round((await sheet.boundingBox())?.height ?? 0);
    const viewport = page.viewportSize()?.height ?? 0;
    await expect.poll(heightOf).toBe(Math.round(viewport * 0.85));
    const search = picker.getByLabel("Find a person");
    await search.fill(staff.name);
    await expect(picker.locator('[data-slot="picker-row"]')).toHaveCount(1);
    expect(await heightOf()).toBe(Math.round(viewport * 0.85));

    await expectSheetAboveKeyboard(page, sheet, search);
    // With the keyboard up the foot and its Done are still inside the sheet.
    await picker.getByRole("checkbox").check();
    await expect(sheet.locator('[data-slot="people-chosen"]')).toHaveText(
      `1 chosen · ${staff.name}`,
    );

    // Done commits nothing: it closes the sheet, and the form has the person and what was typed.
    const done = sheet.getByRole("button", { name: "Done" });
    expect((await done.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await done.click();
    await expect(sheet).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Title")).toHaveValue("Keyboard draft");
    await expect(dialog.locator('[data-slot="task-assignee"]')).toContainText(staff.name);
    await expect(page).toHaveURL(/\/tasks$/);
  });
});

test.describe("New task while its setup loads", () => {
  // `ownSession` gives the page a session of its own, written over the saved Owner's cookie.
  test.use({ storageState: storageStateFor("owner") });

  test("the skeleton traces the form's first state: Type, the dimmed Title, the two buttons", async ({
    page,
  }) => {
    // The form's setup reads the task templates; the page and its New task button do not
    // wait for them, so held there the form opens on its skeleton (ARCHITECTURE §14.1).
    const session = await ownSession(page, USERS.owner.email, USERS.owner.password);
    const hold = await holdReads("/rest/v1/task_templates", session);
    const dialog = formDialog(page);
    const boxOf = async (locator: Locator) => {
      const box = await locator.boundingBox();
      expect(box, "the part is drawn").not.toBeNull();
      return box as { x: number; y: number; width: number; height: number };
    };
    const bar = (name: string) => dialog.locator(`[data-trace="${name}"]`);
    let traced: Record<"type" | "title" | "cancel" | "submit", Awaited<ReturnType<typeof boxOf>>>;
    try {
      await page.goto("/tasks", { waitUntil: "commit" });
      await page.getByRole("button", { name: "New task" }).click();
      await expect(dialog.locator('[data-slot="task-form-skeleton"]')).toBeVisible();
      await expect(dialog.locator('[data-slot="task-form"]')).toHaveCount(0);
      expect(hold.caught(), "the setup's read is the one held").toBe(true);
      // The sheet has finished sliding up before anything is measured.
      await animationsSettled(page);
      traced = {
        type: await boxOf(bar("type")),
        title: await boxOf(bar("title")),
        cancel: await boxOf(bar("cancel")),
        submit: await boxOf(bar("submit")),
      };
    } finally {
      hold.release();
    }
    await expect(dialog.locator('[data-slot="task-form"]')).toBeVisible();
    const settled = {
      type: await boxOf(dialog.locator('[data-field="task-type"]')),
      title: await boxOf(dialog.getByLabel("Title")),
      cancel: await boxOf(dialog.getByRole("button", { name: "Cancel" })),
      submit: await boxOf(dialog.getByRole("button", { name: "Create task" })),
    };
    // Nothing moves when the form arrives: the fields at their place and size, the buttons at
    // their line and height (a button is as wide as its word).
    for (const part of ["type", "title"] as const) {
      for (const side of ["x", "y", "width", "height"] as const) {
        expect(
          Math.abs(traced[part][side] - settled[part][side]),
          `${part} ${side}: ${traced[part][side]} then ${settled[part][side]}`,
        ).toBeLessThanOrEqual(1);
      }
    }
    for (const part of ["cancel", "submit"] as const) {
      for (const side of ["y", "height"] as const) {
        expect(
          Math.abs(traced[part][side] - settled[part][side]),
          `${part} ${side}: ${traced[part][side]} then ${settled[part][side]}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });
});
