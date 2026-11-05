import type { Locator, Page } from "@playwright/test";

import { addISTDays, todayIST } from "../src/core/time";
import { openMoreOptions } from "./helpers";

/**
 * The in-app guide's screenshots, one entry per picture (ROADMAP 6b.14, Release 2). Read by
 * `e2e/guide-screenshots.ts` (`pnpm guide:screenshots`), which signs in as the entry's role, opens
 * `path`, runs `prepare`, outlines `highlight` with a numbered badge, crops to `crop` (the viewport
 * when absent) and writes `public/guide/<role>/<name>.webp`. The ids are the contract with the
 * guide's content (`src/modules/guide/domain/content/*`): a step's `shot` names one. A release
 * that moves a button edits its entry here and re-runs the script.
 *
 * Within a role the entries run in this order, in one signed-in page: the Crew member's
 * Start-day picture comes first (their day has not started yet), and Alerts come before the task
 * pages (opening a task marks its alerts read).
 */

export type GuideRole = "owner" | "admin" | "staff";

/** The ids of the demo data the script makes before the pictures (neutral names only). */
export type DemoIds = {
  clientId: string;
  projectId: string;
  /** "Festive campaign": a monthly project On hold, one deliverable's date passed, one from last month. */
  heldProjectId: string;
  staffId: string;
  tasks: {
    /** "Reel 1 edit": assigned to the Crew member, not noted yet; made by the Admin. */
    notNoted: string;
    /** "Reel 2 edit": noted and started, one stage ticked. */
    started: string;
    /** "Reel 3 edit": handed in, waiting for the Admin's check. */
    handedIn: string;
    /** "Reel 4 edit": checked by the Admin, waiting for the Owner. */
    checked: string;
    /** "Post 1 design": handed in, straight to the Owner. */
    ownerOnly: string;
    /** "Post 2 design": made by the Admin, noted, On hold; its deadline passed while held. */
    held: string;
  };
};

export type GuideShot = {
  /** "<role>/<name>": the picture is `public/guide/<role>/<name>.webp`. */
  readonly id: `${GuideRole}/${string}`;
  /** The screen to open. */
  readonly path: string | ((demo: DemoIds) => string);
  /** Taps and fills that bring the screen to the step (open a dialog, a menu, a sheet). */
  readonly prepare?: (page: Page) => Promise<void>;
  /** The one element the step is about: outlined, with the badge at its top-left corner. */
  readonly highlight: (page: Page) => Locator;
  /** The region kept (padded); the whole viewport when absent. */
  readonly crop?: (page: Page) => Locator;
  /** Room kept around the crop, in CSS px; 24 when absent (0 ends it exactly at the region). */
  readonly cropPadding?: number;
  /** The badge's number (the step's number in the topic); 1 when absent. */
  readonly badge?: number;
  /** What the picture shows, in plain words (the image's alt text). */
  readonly alt: string;
  /** Leave the Start-day prompt open (the pictures of the prompt and of the sheets it opens). */
  readonly keepStartPrompt?: boolean;
  /**
   * The working day this picture needs (v1.9 W4, the working hours on): the script builds it before
   * the picture, with the app's own functions and a few fixed times (`e2e/guide-screenshots.ts`),
   * only when it differs from the day already built. Absent: the role's day (`ROLE_DAYS`).
   */
  readonly days?: GuideDays;
};

/**
 * Today's attendance for the Crew member and the Admin, as a picture needs it. The times are
 * fixed (a start at 10:22 am is 22 minutes late; the Admin starts at 9:58 am) and the asks are
 * dated back from the run's own clock, so a run at any time between 11:15 am and 5:30 pm shows the
 * same states.
 */
export type CrewDay =
  /** Not started: the Started working? prompt. */
  | "not_started"
  /** Not started, with a shoot at 3:00 pm today: the late sheet suggests "Shoot at 3:00 pm". */
  | "not_started_shoot"
  /** Started at 10:22 am, Late 22 min with a reason. */
  | "late"
  /** Late, and asked to leave early 12 minutes ago: Waiting. */
  | "asked"
  /** Late, and asked 35 minutes ago with no answer: End day is back. */
  | "no_answer"
  /** Late, and the Owner approved an ask of 20 minutes ago: the day ended then. */
  | "approved"
  /** Late, asked 40 minutes ago and ended the day with no answer: Left early, not answered. */
  | "left_unanswered";
export type AdminDay =
  /** Started at 9:58 am, on time. */
  | "started"
  /** Started on time and asked to leave early 8 minutes ago: Leaving early on the Owner's Approvals. */
  | "asked";
export type GuideDays = { readonly crew?: CrewDay; readonly admin?: AdminDay };

/** The day each role's pictures start from (a picture's own `days` changes it). */
export const ROLE_DAYS: Readonly<Record<GuideRole, GuideDays>> = {
  staff: { crew: "late" },
  admin: { admin: "started" },
  // The Owner decides: the Admin waits under Leaving early, the Crew member under Left early, not
  // answered; Today, the reports and the person's Attendance show the Late start.
  owner: { crew: "left_unanswered", admin: "asked" },
};

// ── Locators the entries share ─────────────────────────────────────────────────────────────────

/** The screen's content, beside the sidebar. */
const main = (page: Page) => page.locator('[data-slot="route"]:visible');
/** The open dialog or sheet on top (a sheet opened from a sheet is the last one). */
const layer = (page: Page) =>
  page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').last();
const slot = (page: Page, name: string) => page.locator(`[data-slot="${name}"]:visible`);
const button = (page: Page, name: string | RegExp) =>
  page.getByRole("button", { name, exact: typeof name === "string" }).first();

async function tap(page: Page, name: string | RegExp): Promise<void> {
  await button(page, name).click();
}

async function openMenu(page: Page, trigger: string, item: string): Promise<void> {
  await tap(page, trigger);
  await page.getByRole("menuitem", { name: item }).click();
}

const project = (demo: DemoIds) => `/clients/${demo.clientId}/projects/${demo.projectId}`;
const projects = (demo: DemoIds) => `/clients/${demo.clientId}/projects`;

async function openDeliverable(page: Page, title: string): Promise<void> {
  await page.locator('[data-slot="item-open"]', { hasText: title }).first().click();
  await layer(page).waitFor();
}

/** A deliverable's row on the project page's list (open ones; "Reel 2" never matches "Reel 20"). */
const deliverableRow = (page: Page, title: string) =>
  page
    .locator('[data-slot="item-row"]')
    .filter({ has: page.locator('[data-slot="item-open"]', { hasText: title }) })
    .first();

/** Reel 2's first stage line opened in place, its stage chips showing. */
async function openStageLine(page: Page): Promise<void> {
  await deliverableRow(page, "Reel 2").locator('[data-slot="item-progress"]').first().click();
  await deliverableRow(page, "Reel 2").locator('[data-slot="item-stages"]').first().waitFor();
}

/** Select mode with Reel 3 and Reel 4 selected: the bar shows Mark 2 done, Tick a stage, Edit 2. */
async function selectTwo(page: Page): Promise<void> {
  // The laptop's "turn on notifications" band would sit under the floating Select bar and cut it
  // from the crop; a device with notifications on has no band, so the picture shows that.
  await page.addStyleTag({ content: '[data-slot="push-banner"] { display: none !important; }' });
  await slot(page, "select-mode").click();
  for (const title of ["Reel 3", "Reel 4"]) {
    await page.getByRole("checkbox", { name: `Select ${title}` }).click();
  }
  await slot(page, "bulk-edit").waitFor();
}

/** Edit 2 → Rename…, "Reel {n}" from 5: the sheet's Preview lists the new names. */
async function renameTwo(page: Page): Promise<void> {
  await selectTwo(page);
  await openMenu(page, "Edit 2", "Rename…");
  const sheet = layer(page);
  await sheet.getByLabel("New name", { exact: true }).fill("Reel {n}");
  await sheet.getByLabel("Start at", { exact: true }).fill("5");
  await slot(page, "rename-preview-row").first().waitFor();
}

/** A deliverable's sheet with its ⋯ open (Another revision round, Move up, Move down, …). */
async function openDeliverableMenu(page: Page, title: string): Promise<void> {
  await openDeliverable(page, title);
  await layer(page)
    .getByRole("button", { name: `More for ${title}` })
    .click();
  await page.getByRole("menuitem", { name: "Another revision round" }).waitFor();
}

/** New project with default stages from a preset and four deliverables, so the preview shows them. */
async function newProjectWithDeliverables(page: Page): Promise<void> {
  await tap(page, "New project");
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Project name").fill("Quarterly reels");
  // V5b PP-forms-7: the deliverables and stages are step 2.
  await dialog.locator('[data-slot="new-project-next"]').click();
  await dialog.getByRole("combobox", { name: /preset/i }).click();
  await page.getByRole("option", { name: "Video steps" }).click();
  await dialog.getByLabel("Deliverable name").fill("Reel");
  await dialog.getByLabel("How many").fill("4");
  await dialog.locator('[data-slot="add-deliverables-confirm"]').click();
  await dialog.locator('[data-slot="preview-deliverable"]').first().waitFor();
  // Back to the top of the form, where the preview sits beside the name.
  await dialog.evaluate((root) => {
    for (const node of [root, ...root.querySelectorAll<HTMLElement>("*")]) node.scrollTop = 0;
  });
}

/** The task's ⋯ open (the Owner, or the Admin who created it, sees Put on hold…). */
const openTaskMenu = (page: Page) => tap(page, "Task actions");

/** A hold's reason sheet from ⋯, its reason written, not sent. */
async function holdSheet(page: Page, menu: () => Promise<void>): Promise<void> {
  await menu();
  await page.getByRole("menuitem", { name: "Put on hold…" }).click();
  await layer(page).getByLabel("Why").fill("Client hasn't sent the footage");
}

/** A held task's Resume, its deadline passed: the new-deadline sheet, a date and time chosen. */
async function resumeTaskSheet(page: Page): Promise<void> {
  await slot(page, "task-resume").click();
  const sheet = layer(page);
  await sheet.getByLabel("New deadline").fill(addISTDays(todayIST(), 1));
  await sheet.getByLabel("Time").fill("17:30");
}

/** The held project's resume sheet open, its rows listed. */
async function resumeProjectSheet(page: Page): Promise<void> {
  await slot(page, "project-resume").click();
  await layer(page).locator('[data-slot="resume-row"]').first().waitFor();
}

const heldTask = (demo: DemoIds) => `/tasks/${demo.tasks.held}`;
const heldProject = (demo: DemoIds) => `/clients/${demo.clientId}/projects/${demo.heldProjectId}`;

/**
 * On hold (v1.9), the same eight pictures for the Owner and the Admin (who created the tasks and
 * runs the client): Put on hold… in ⋯, the reason sheet, the amber line or banner with Resume, and
 * the resume sheet, for a task and for a project.
 */
function holdShots(role: "owner" | "admin"): GuideShot[] {
  return [
    {
      id: `${role}/task-hold-menu`,
      path: (demo) => `/tasks/${demo.tasks.started}`,
      prepare: openTaskMenu,
      highlight: (page) => page.getByRole("menuitem", { name: "Put on hold…" }),
      crop: main,
      alt: "A task's ⋯ menu open with Put on hold… highlighted.",
    },
    {
      id: `${role}/task-hold-sheet`,
      path: (demo) => `/tasks/${demo.tasks.started}`,
      prepare: (page) => holdSheet(page, () => openTaskMenu(page)),
      highlight: (page) => layer(page).getByRole("button", { name: "Put on hold", exact: true }),
      crop: layer,
      badge: 2,
      alt: "The Put on hold sheet with its reason written and the Put on hold button highlighted.",
    },
    {
      id: `${role}/task-hold-line`,
      path: heldTask,
      highlight: (page) => slot(page, "task-resume"),
      crop: main,
      badge: 3,
      alt: "A task On hold: the amber chip, the On hold since line with the reason and its Resume button highlighted.",
    },
    {
      id: `${role}/task-resume-sheet`,
      path: heldTask,
      prepare: resumeTaskSheet,
      highlight: (page) => layer(page).getByLabel("New deadline"),
      crop: layer,
      badge: 4,
      alt: "The Resume sheet of a task whose deadline passed, with the New deadline field highlighted.",
    },
    {
      id: `${role}/project-hold-menu`,
      path: project,
      prepare: (page) => tap(page, "Actions for Monthly retainer"),
      highlight: (page) => page.getByRole("menuitem", { name: "Put on hold…" }),
      crop: main,
      alt: "The project's ⋯ menu open with Put on hold… highlighted.",
    },
    {
      id: `${role}/project-hold-sheet`,
      path: project,
      prepare: (page) => holdSheet(page, () => tap(page, "Actions for Monthly retainer")),
      highlight: (page) => layer(page).getByRole("button", { name: "Put on hold", exact: true }),
      crop: layer,
      badge: 2,
      alt: "The project's Put on hold sheet with its reason written and the Put on hold button highlighted.",
    },
    {
      id: `${role}/project-hold-banner`,
      path: heldProject,
      highlight: (page) => slot(page, "project-resume"),
      crop: main,
      badge: 3,
      alt: "A project On hold: the amber banner with the reason, its deliverables On hold, and Resume… highlighted.",
    },
    {
      // v2.0 X1: a held project reads On hold on the client's Projects tab, never Open.
      id: `${role}/project-held-row`,
      path: (demo) => `/clients/${demo.clientId}/projects`,
      highlight: (page) =>
        page
          .locator('[data-slot="project-row"]')
          .filter({ has: page.locator('[data-status="on_hold"]') })
          .first(),
      crop: main,
      alt: "The client's Projects tab with the held project's row and its amber On hold chip highlighted.",
    },
    {
      // v2.0 X1: a held project's deliverable says why its ticks wait as soon as it opens.
      id: `${role}/item-held-sheet`,
      path: heldProject,
      prepare: async (page) => {
        await page.locator('[data-slot="item-open"]').first().click();
        await slot(page, "item-hold-note").waitFor();
      },
      highlight: (page) => slot(page, "item-hold-note"),
      crop: layer,
      alt: "A held project's deliverable sheet: the On hold chip and the line saying ticks and Mark done wait until it is resumed, highlighted.",
    },
    {
      id: `${role}/project-resume-sheet`,
      path: heldProject,
      prepare: resumeProjectSheet,
      highlight: (page) => layer(page).locator('[data-slot="resume-rows"]'),
      crop: layer,
      badge: 4,
      alt: "The Resume sheet listing a deliverable that needs a new date and one from an ended month with its choices, highlighted.",
    },
  ];
}

// ── The pictures ───────────────────────────────────────────────────────────────────────────────

export const GUIDE_SHOT_LIST: readonly GuideShot[] = [
  // Crew
  {
    id: "staff/start-day",
    path: "/my-day",
    days: { crew: "not_started" },
    keepStartPrompt: true,
    highlight: (page) => slot(page, "start-day-prompt").getByRole("button", { name: "Start day" }),
    crop: (page) => slot(page, "start-day-prompt"),
    badge: 2,
    alt: "The Started working? prompt with the Start day button highlighted.",
  },
  {
    id: "staff/start-prompt-half",
    path: "/my-day",
    days: { crew: "not_started" },
    keepStartPrompt: true,
    prepare: async (page) => {
      await slot(page, "start-day-prompt")
        .getByRole("button", { name: "On leave today? Choose leave" })
        .click();
      await slot(page, "start-day-prompt")
        .getByRole("radio", { name: /^Half day/ })
        .check();
    },
    highlight: (page) => slot(page, "half-choice"),
    crop: (page) => slot(page, "start-day-prompt"),
    badge: 4,
    alt: "The On leave today? view with Half day chosen and its Morning off and Afternoon off cards highlighted.",
  },
  {
    id: "staff/late-sheet",
    path: "/my-day",
    days: { crew: "not_started_shoot" },
    keepStartPrompt: true,
    prepare: async (page) => {
      await slot(page, "start-day-prompt").getByRole("button", { name: "Start day" }).click();
      await slot(page, "late-sheet").waitFor();
    },
    highlight: (page) => slot(page, "late-sheet").getByLabel("Reason (optional)"),
    crop: (page) => slot(page, "late-sheet"),
    badge: 2,
    alt: "The You're starting late sheet: Suggested from your calendar, with the reason Shoot at 3:00 pm highlighted.",
  },
  {
    id: "staff/my-day",
    path: "/my-day",
    highlight: (page) => slot(page, "attendance-strip"),
    crop: main,
    alt: "My Day with today's attendance strip highlighted at the top.",
  },
  {
    id: "staff/late-chip",
    path: "/my-day",
    highlight: (page) => slot(page, "attendance-hours"),
    crop: (page) => slot(page, "attendance-strip"),
    cropPadding: 12,
    badge: 4,
    alt: "The attendance strip with the amber Late 22 min chip, the reason and Your day ends at 6:00 pm highlighted.",
  },
  {
    id: "staff/alerts",
    path: "/notifications",
    highlight: (page) => slot(page, "mark-all-read"),
    crop: main,
    alt: "Alerts, the list of notifications, with Mark all read highlighted.",
  },
  {
    id: "staff/leave-early-sheet",
    path: "/my-day",
    prepare: async (page) => {
      await slot(page, "ask-leave-early").click();
      await layer(page).getByLabel("Why").fill("Doctor's appointment at 5");
    },
    highlight: (page) => slot(page, "ask-the-owner"),
    crop: layer,
    badge: 3,
    alt: "The Ask to leave early sheet with Leave at the time now, the reason written, and Ask the Owner highlighted.",
  },
  {
    id: "staff/leave-early-waiting",
    path: "/my-day",
    days: { crew: "asked" },
    highlight: (page) => slot(page, "attendance-early"),
    crop: (page) => slot(page, "attendance-strip"),
    cropPadding: 12,
    badge: 4,
    alt: "The attendance strip with the Waiting line highlighted: asked to leave, how long ago, and when End day comes back.",
  },
  {
    id: "staff/end-day",
    path: "/my-day",
    // End day before the end time: the ask had no answer in 30 minutes, so End day is back. The
    // confirmation is the one every End day opens.
    days: { crew: "no_answer" },
    prepare: (page) => tap(page, "End day"),
    highlight: (page) => layer(page).getByRole("button", { name: "End day", exact: true }),
    crop: layer,
    badge: 4,
    alt: "The End your day? confirmation with the End day button highlighted.",
  },
  {
    id: "staff/leave-early-approved",
    path: "/my-day",
    days: { crew: "approved" },
    highlight: (page) => slot(page, "early-leave-claim"),
    crop: (page) => slot(page, "attendance-strip"),
    cropPadding: 12,
    badge: 5,
    alt: "The attendance strip after the Owner approved: the day ended at the time asked, with Any expenses to claim today? highlighted.",
  },
  {
    id: "staff/request-leave",
    path: "/leave",
    prepare: (page) => tap(page, "Request leave"),
    highlight: (page) => layer(page).getByLabel("Kind of leave"),
    crop: layer,
    badge: 2,
    alt: "The Request leave form with the Kind of leave field highlighted.",
  },
  {
    id: "staff/request-half",
    path: "/leave",
    prepare: async (page) => {
      await tap(page, "Request leave");
      await layer(page).getByLabel("Kind of leave").click();
      await page.getByRole("option", { name: "Half day", exact: true }).click();
      await layer(page).locator('[data-slot="half-choice"]').waitFor();
    },
    highlight: (page) => slot(page, "half-choice"),
    crop: layer,
    badge: 3,
    alt: "The Request leave form for a half day, with Which half? and its Morning off and Afternoon off cards highlighted.",
  },
  {
    id: "staff/leave-list",
    path: "/leave",
    highlight: (page) => button(page, "Withdraw"),
    crop: main,
    alt: "Leave requests with a waiting request and its Withdraw button highlighted.",
  },
  {
    id: "staff/attendance-tab",
    path: "/leave/attendance",
    highlight: (page) => slot(page, "leave-tabs").getByRole("link", { name: "Attendance" }),
    crop: main,
    alt: "Attendance and leave with the Attendance tab highlighted, showing this month's days.",
  },
  {
    id: "staff/my-tasks",
    path: "/tasks",
    highlight: (page) => slot(page, "tasks-group-not_noted"),
    crop: main,
    alt: "Tasks with the Not noted group highlighted at the top.",
  },
  {
    id: "staff/task-noted",
    path: (demo) => `/tasks/${demo.tasks.notNoted}`,
    highlight: (page) => button(page, "Task Noted"),
    crop: main,
    alt: "A new task's page with the Task Noted button highlighted.",
  },
  {
    id: "staff/task-stages",
    path: (demo) => `/tasks/${demo.tasks.started}`,
    highlight: (page) => slot(page, "task-stages"),
    crop: main,
    alt: "A started task with its list of stages highlighted, the first one ticked.",
  },
  {
    id: "staff/mark-done",
    path: (demo) => `/tasks/${demo.tasks.started}`,
    prepare: (page) => tap(page, "Mark done"),
    highlight: (page) => layer(page).getByLabel("Note (optional)"),
    crop: layer,
    alt: "The Mark done dialog with its Note field highlighted.",
  },
  {
    id: "staff/tasks-on-hold",
    path: "/tasks",
    highlight: (page) => slot(page, "tasks-on-hold"),
    crop: main,
    alt: "Tasks with the On hold line highlighted under the lists.",
  },
  {
    // v2.0 X1: My Day says a held task is on hold instead of dropping it silently.
    id: "staff/my-day-on-hold",
    path: "/my-day",
    highlight: (page) => slot(page, "my-day-on-hold"),
    crop: main,
    alt: "My Day with the On hold line highlighted under the day's lists.",
  },
  {
    id: "staff/task-on-hold",
    path: heldTask,
    highlight: (page) => slot(page, "task-hold-line"),
    crop: main,
    badge: 2,
    alt: "A task On hold: the amber chip and the On hold since line with the reason, highlighted.",
  },
  {
    id: "staff/suggest-task",
    path: "/my-day",
    prepare: (page) => tap(page, "Suggest a task"),
    highlight: (page) => layer(page).getByLabel("What needs doing"),
    crop: layer,
    alt: "The Suggest a task dialog with the What needs doing field highlighted.",
  },
  {
    id: "staff/calendar",
    path: "/calendar?view=month",
    highlight: (page) => button(page, /, today$/),
    crop: main,
    alt: "The calendar's month with today's date highlighted.",
  },
  {
    id: "staff/extra-work-note",
    path: "/leave/extra-work",
    prepare: (page) => tap(page, "Add note"),
    highlight: (page) => layer(page).getByLabel("What you worked on"),
    crop: layer,
    alt: "The extra work note form with the What you worked on field highlighted.",
  },
  {
    id: "staff/add-expense",
    path: "/leave/expenses",
    prepare: (page) => tap(page, "Add expense"),
    highlight: (page) => slot(page, "receipt-field"),
    crop: layer,
    alt: "The Add an expense form with the Receipt photo field highlighted.",
  },
  {
    id: "staff/me-notifications",
    path: "/me",
    highlight: (page) => slot(page, "push-device-row"),
    crop: main,
    alt: "Me, with the Notifications row highlighted.",
  },
  {
    id: "staff/me-help",
    path: "/me",
    highlight: (page) => slot(page, "me-guide-link"),
    crop: main,
    alt: "Me, with the How MaxOff works row under Help and troubleshooting highlighted.",
  },

  // Admin
  {
    id: "admin/today",
    path: "/today",
    highlight: (page) => slot(page, "today-needs-you"),
    crop: main,
    alt: "Today with the Needs you card highlighted.",
  },
  {
    id: "admin/start-end-day",
    path: "/today",
    highlight: (page) => slot(page, "ask-leave-early"),
    crop: (page) => slot(page, "attendance-strip"),
    cropPadding: 12,
    badge: 4,
    alt: "Today's attendance strip, started on time, with Your day ends at 6:00 pm and the Ask to leave early button highlighted.",
  },
  {
    id: "admin/approvals",
    path: "/approvals",
    highlight: (page) =>
      page.locator('[data-slot="approval-group"][data-group="tasks"]').getByRole("button", {
        name: "Approve",
        exact: true,
      }),
    crop: main,
    alt: "Approvals with one handed-in task and its Approve button highlighted.",
  },
  {
    id: "admin/new-task",
    path: "/tasks",
    prepare: (page) => tap(page, "New task"),
    highlight: (page) => slot(page, "task-assignees"),
    crop: layer,
    alt: "The New task form with the Assign to field highlighted.",
  },
  {
    id: "admin/task-review",
    path: (demo) => `/tasks/${demo.tasks.handedIn}`,
    highlight: (page) => slot(page, "task-next-step"),
    crop: main,
    alt: "A handed-in task with the Request changes and Approve buttons highlighted.",
  },
  {
    id: "admin/task-stages",
    path: (demo) => `/tasks/${demo.tasks.notNoted}`,
    highlight: (page) => slot(page, "reorder-handle").first(),
    crop: (page) => slot(page, "task-stages"),
    alt: "A task's stages with the drag handle of the first stage highlighted.",
  },
  {
    id: "admin/calendar-day",
    path: "/calendar?view=month",
    // The first day with tasks due: the sheet opens on them, then who is away and the buttons.
    prepare: (page) => tap(page, /, \d+ due$/),
    highlight: (page) => layer(page).getByRole("button", { name: /New task on/ }),
    crop: layer,
    alt: "A day opened from the calendar, its tasks due listed, with the New task on this day button highlighted.",
  },
  {
    id: "admin/clients",
    path: "/clients",
    highlight: (page) => page.getByRole("row", { name: /Sample Client/ }),
    crop: main,
    alt: "Clients with the Sample Client row highlighted.",
  },
  {
    id: "admin/new-client",
    path: "/clients",
    prepare: (page) => tap(page, "New client"),
    highlight: (page) => layer(page).getByLabel("Client name"),
    crop: layer,
    alt: "The New client dialog with the Client name field highlighted.",
  },
  {
    id: "admin/client-page",
    path: (demo) => `/clients/${demo.clientId}`,
    highlight: (page) => slot(page, "client-tabs"),
    crop: main,
    alt: "A client's page with its tabs highlighted: Overview, Projects and Brand.",
  },
  {
    id: "admin/new-project",
    path: projects,
    prepare: (page) => tap(page, "New project"),
    highlight: (page) => layer(page).getByRole("combobox", { name: "Repeats" }),
    crop: layer,
    alt: "The New project form with the Repeats field highlighted.",
  },
  {
    id: "admin/project-preview",
    path: projects,
    prepare: newProjectWithDeliverables,
    highlight: (page) => slot(page, "new-project-preview"),
    crop: layer,
    alt: "The New project form with four deliverables added and the live preview highlighted.",
  },
  {
    id: "admin/project-page",
    path: project,
    highlight: (page) => slot(page, "cycle-meter"),
    crop: main,
    alt: "A project's page with this month's progress ring highlighted.",
  },
  {
    id: "admin/deliverable-sheet",
    path: project,
    prepare: (page) => openDeliverable(page, "Reel 2"),
    // PP-sheet-2: the sheet's one action, "Next: ‹stage›" until every stage is ticked, then Mark done.
    highlight: (page) =>
      layer(page).locator('[data-slot="item-next-stage"], [data-slot="item-mark-done"]'),
    crop: layer,
    alt: "A deliverable's sheet with its stages and its next step highlighted.",
  },
  {
    id: "admin/edit-stages",
    path: project,
    prepare: async (page) => {
      await openDeliverable(page, "Reel 2");
      await tap(page, "Edit stages");
    },
    highlight: (page) => layer(page).getByRole("combobox", { name: /preset/i }),
    crop: layer,
    alt: "The Stages of Reel 2 sheet with Add from a preset highlighted.",
  },
  {
    id: "admin/deliverable-rows",
    path: project,
    prepare: openStageLine,
    highlight: (page) =>
      deliverableRow(page, "Reel 2").locator('[data-slot="item-progress"]').first(),
    crop: (page) => slot(page, "cycle-items"),
    alt: "The project's deliverables, with Reel 2's Video steps line opened to its stage chips and highlighted.",
  },
  {
    id: "admin/revision-round",
    path: project,
    prepare: (page) => openDeliverableMenu(page, "Reel 2"),
    highlight: (page) => page.getByRole("menuitem", { name: "Another revision round" }),
    crop: layer,
    alt: "Reel 2's sheet with its ⋯ menu open and Another revision round highlighted.",
  },
  {
    id: "admin/select-edit",
    path: project,
    prepare: selectTwo,
    highlight: (page) => slot(page, "bulk-edit"),
    crop: main,
    alt: "The deliverables in Select mode with Reel 3 and Reel 4 selected, and Edit 2 highlighted in the bar.",
  },
  {
    id: "admin/copy-schedule",
    path: project,
    prepare: (page) => tap(page, "Actions for Monthly retainer"),
    highlight: (page) => page.getByRole("menuitem", { name: "Copy schedule as text" }),
    crop: main,
    alt: "The project's ⋯ menu open with Copy schedule as text highlighted.",
  },
  ...holdShots("admin"),
  {
    id: "admin/stage-presets",
    path: "/settings/templates#presets",
    highlight: (page) => slot(page, "add-stage-preset"),
    crop: main,
    alt: "Stage presets with the Add preset button highlighted.",
  },
  {
    id: "admin/templates",
    path: "/settings/templates",
    highlight: (page) => slot(page, "template-search"),
    crop: main,
    alt: "Templates with the search box highlighted.",
  },
  {
    id: "admin/template-builder",
    path: "/settings/templates#projects",
    prepare: async (page) => {
      await tap(page, "Add project template");
      await layer(page).waitFor();
    },
    highlight: (page) => layer(page).getByLabel("How many"),
    crop: layer,
    alt: "The Add a project template form with the How many field highlighted.",
  },
  {
    id: "admin/save-as-template",
    path: project,
    prepare: (page) => openMenu(page, "Actions for Monthly retainer", "Save as template"),
    highlight: (page) => layer(page).getByLabel("Template name"),
    crop: layer,
    alt: "The Save as template dialog with the Template name field highlighted.",
  },
  {
    id: "admin/deliverables-list",
    path: project,
    prepare: (page) => openMenu(page, "Actions for Monthly retainer", "Deliverables list"),
    highlight: (page) =>
      layer(page)
        .getByRole("button", { name: /Stages/ })
        .first(),
    crop: layer,
    alt: "The Deliverables list sheet with the first line's Stages button highlighted.",
  },
  {
    id: "admin/client-deliverables",
    path: "/clients/items",
    prepare: (page) => page.getByRole("combobox", { name: "State" }).click(),
    highlight: (page) => page.getByRole("option", { name: "Overdue" }),
    crop: main,
    alt: "Client deliverables with the filter open and Overdue highlighted.",
  },
  {
    id: "admin/settings",
    path: "/settings",
    highlight: (page) => slot(page, "settings-guide-link"),
    crop: main,
    alt: "Settings with Help and troubleshooting highlighted.",
  },

  // Owner
  {
    id: "owner/today",
    path: "/today",
    highlight: (page) => slot(page, "today-approvals"),
    crop: main,
    alt: "Today with the Needs you card highlighted, listing what waits for a decision.",
  },
  {
    id: "owner/attendance-board",
    path: "/today",
    highlight: (page) => slot(page, "today-strip"),
    crop: main,
    badge: 2,
    alt: "Today with the attendance counts highlighted.",
  },
  {
    id: "owner/today-late-line",
    path: "/today",
    highlight: (page) => page.locator('[data-slot="today-hours-line"][data-line="late"]:visible'),
    crop: (page) => slot(page, "today-attendance-card"),
    badge: 3,
    alt: "Today's Attendance card with the amber 1 started late today line highlighted.",
  },
  {
    id: "owner/everyone-today",
    path: "/today/people",
    highlight: (page) => slot(page, "people-filter"),
    crop: main,
    alt: "Everyone today with the filter highlighted.",
  },
  {
    id: "owner/approvals",
    path: "/approvals",
    highlight: (page) =>
      page
        .locator('[data-slot="approval-group"][data-group="tasks"]')
        .getByRole("button", { name: "Approve", exact: true })
        .first(),
    crop: main,
    alt: "Approvals grouped by kind, with the first task's Approve button highlighted.",
  },
  {
    id: "owner/early-leave",
    path: "/approvals",
    highlight: (page) => page.locator('[data-slot="approval-group"][data-group="early-leave"]'),
    crop: main,
    badge: 2,
    alt: "Approvals with the Leaving early group highlighted: who, the time asked, the reason, Stay and Approve.",
  },
  {
    id: "owner/left-early-unanswered",
    path: "/approvals",
    highlight: (page) =>
      page.locator('[data-slot="approval-group"][data-group="early-leave-unanswered"]'),
    crop: main,
    badge: 4,
    alt: "Approvals with the Left early, not answered group highlighted, its row with Approve.",
  },
  {
    id: "owner/stay-until-sheet",
    path: "/today/people",
    prepare: async (page) => {
      await slot(page, "stay-until-open").click();
      await slot(page, "stay-until-sheet").waitFor();
    },
    highlight: (page) => slot(page, "stay-until-set"),
    crop: (page) => slot(page, "stay-until-sheet"),
    badge: 3,
    alt: "The Stay until sheet for a person, its time two hours after the end time, with the Set 8:00 pm button highlighted.",
  },
  {
    id: "owner/person-attendance",
    path: (demo) => `/people/${demo.staffId}/attendance`,
    highlight: (page) =>
      main(page).getByRole("row").filter({ hasText: "Left early, not answered" }).first(),
    crop: main,
    alt: "A person's Attendance tab with today's row highlighted: started late, Late 22 min with the reason, Left early, not answered.",
  },
  {
    id: "owner/approve-all",
    path: "/approvals",
    highlight: (page) => button(page, /^Approve all \d+$/),
    crop: main,
    alt: "Approvals with the Approve all button of the tasks group highlighted.",
  },
  {
    id: "owner/leave-review",
    path: "/approvals",
    prepare: (page) =>
      page
        .locator('[data-slot="approval-group"][data-group="leave"]')
        .getByRole("button", { name: "Review" })
        .first()
        .click(),
    highlight: (page) => layer(page).getByRole("button", { name: /^Reject/ }),
    crop: layer,
    alt: "A leave request's review sheet with the Reject button highlighted.",
  },
  {
    id: "owner/new-task",
    path: "/tasks",
    prepare: async (page) => {
      await tap(page, "New task");
      await openMoreOptions(page);
    },
    highlight: (page) => layer(page).getByLabel("Checked first by"),
    crop: layer,
    alt: "The New task form with the Checked first by field highlighted.",
  },
  {
    id: "owner/task-approve",
    path: (demo) => `/tasks/${demo.tasks.checked}`,
    highlight: (page) =>
      slot(page, "task-next-step").getByRole("button", { name: "Approve", exact: true }),
    crop: main,
    alt: "A task the Admin has checked, with the Owner's Approve button highlighted.",
  },
  {
    id: "owner/task-menu",
    path: (demo) => `/tasks/${demo.tasks.handedIn}`,
    prepare: (page) => tap(page, "Task actions"),
    highlight: (page) => page.getByRole("menuitem", { name: "Decide it yourself" }),
    crop: main,
    alt: "A task's menu open with Decide it yourself highlighted.",
  },
  {
    id: "owner/remind",
    path: (demo) => `/tasks/${demo.tasks.notNoted}`,
    highlight: (page) => slot(page, "task-remind"),
    crop: main,
    alt: "A task not noted yet, with the Remind button highlighted.",
  },
  {
    id: "owner/calendar",
    path: "/calendar?view=month",
    highlight: (page) => slot(page, "calendar-filters-button"),
    crop: main,
    alt: "The calendar with the Filters button highlighted.",
  },
  {
    id: "owner/people",
    path: "/people",
    highlight: (page) => slot(page, "add-person"),
    // The three active people sort first; the deactivated flow-test fixtures below them stay out.
    crop: (page) => main(page).locator("tbody tr").nth(2),
    cropPadding: 0,
    alt: "People with the Add person button highlighted.",
  },
  {
    id: "owner/person-leave",
    path: (demo) => `/people/${demo.staffId}/leave`,
    highlight: (page) => slot(page, "grant-comp-leave"),
    crop: main,
    alt: "A person's Leave tab with the Grant comp leave button highlighted.",
  },
  {
    id: "owner/clients",
    path: "/clients",
    highlight: (page) => button(page, "Actions for Sample Client"),
    crop: main,
    alt: "Clients with a row's actions button highlighted, where Change Admin is.",
  },
  {
    id: "owner/client-states",
    path: (demo) => `/clients/${demo.clientId}`,
    prepare: (page) => tap(page, "Actions for Sample Client"),
    highlight: (page) => page.getByRole("menuitem", { name: "Pause" }),
    crop: main,
    alt: "A client's menu open with Pause highlighted.",
  },
  {
    id: "owner/new-project",
    path: projects,
    prepare: (page) => tap(page, "New project"),
    highlight: (page) => layer(page).getByRole("button", { name: "Start from a template" }),
    crop: layer,
    alt: "The New project form with the Start from a template button highlighted.",
  },
  {
    id: "owner/project-preview",
    path: projects,
    prepare: newProjectWithDeliverables,
    highlight: (page) => slot(page, "preview-tag").first(),
    crop: layer,
    alt: "The New project preview with the Default stages tag highlighted.",
  },
  {
    id: "owner/project-page",
    path: project,
    highlight: (page) => slot(page, "cycle-meter"),
    crop: main,
    alt: "A project's page with this month's progress ring highlighted.",
  },
  {
    id: "owner/deliverable-rows",
    path: project,
    prepare: openStageLine,
    highlight: (page) =>
      deliverableRow(page, "Reel 2").locator('[data-slot="item-progress"]').first(),
    crop: (page) => slot(page, "cycle-items"),
    alt: "The project's deliverables, with Reel 2's Video steps line opened to its stage chips and highlighted.",
  },
  {
    id: "owner/revision-round",
    path: project,
    prepare: (page) => openDeliverableMenu(page, "Reel 2"),
    highlight: (page) => page.getByRole("menuitem", { name: "Another revision round" }),
    crop: layer,
    alt: "Reel 2's sheet with its ⋯ menu open and Another revision round highlighted.",
  },
  {
    id: "owner/select-edit",
    path: project,
    prepare: selectTwo,
    highlight: (page) => slot(page, "bulk-edit"),
    crop: main,
    alt: "The deliverables in Select mode with Reel 3 and Reel 4 selected, and Edit 2 highlighted in the bar.",
  },
  {
    id: "owner/bulk-rename",
    path: project,
    prepare: renameTwo,
    highlight: (page) => slot(page, "rename-preview"),
    crop: layer,
    alt: "The Rename deliverables sheet with Reel {n} from 5 and its Preview highlighted: Reel 3 becomes Reel 5, Reel 4 becomes Reel 6.",
  },
  {
    id: "owner/copy-schedule",
    path: project,
    prepare: (page) => tap(page, "Actions for Monthly retainer"),
    highlight: (page) => page.getByRole("menuitem", { name: "Copy schedule as text" }),
    crop: main,
    alt: "The project's ⋯ menu open with Copy schedule as text highlighted.",
  },
  ...holdShots("owner"),
  {
    id: "owner/send-back",
    path: project,
    prepare: async (page) => {
      await slot(page, "finished-toggle").click();
      await openDeliverable(page, "Reel 1");
    },
    highlight: (page) => layer(page).getByRole("button", { name: /^Send back/ }),
    crop: layer,
    alt: "A done deliverable's sheet with the Send back button highlighted.",
  },
  {
    id: "owner/templates",
    path: "/settings/templates#projects",
    highlight: (page) => button(page, "Preview Monthly reels"),
    crop: main,
    alt: "Templates with a project template's Preview button highlighted.",
  },
  {
    id: "owner/delete-unused",
    path: "/settings/job-titles",
    highlight: (page) => button(page, "Delete Graphic Designer"),
    crop: main,
    alt: "Job titles with a row's red Delete highlighted.",
  },
  {
    id: "owner/settings",
    path: "/settings",
    highlight: (page) => page.getByRole("link", { name: /^Thresholds/ }),
    crop: main,
    alt: "Settings with Thresholds highlighted.",
  },
  {
    id: "owner/thresholds",
    path: "/settings/thresholds",
    prepare: (page) => page.locator("summary").getByText("Tasks", { exact: true }).click(),
    highlight: (page) => page.getByLabel("Acknowledgement reminder (hours)"),
    crop: main,
    badge: 3,
    alt: "Thresholds with the Acknowledgement reminder (hours) field highlighted.",
  },
  {
    id: "owner/thresholds-working-day",
    path: "/settings/thresholds",
    prepare: (page) => page.locator("summary").getByText("Working day", { exact: true }).click(),
    highlight: (page) => slot(page, "working-hours-switch"),
    crop: main,
    badge: 5,
    alt: "Thresholds with Working day open and the Working hours switch highlighted, above Work starts, Work ends and Late after.",
  },
  {
    id: "owner/thresholds-approvals",
    path: "/settings/thresholds",
    prepare: (page) => page.locator("summary").getByText("Approvals", { exact: true }).click(),
    highlight: (page) => page.getByLabel("Urgent tasks: remind every (minutes)"),
    crop: main,
    badge: 6,
    alt: "Thresholds with Approvals open and the Urgent tasks: remind every (minutes) field highlighted.",
  },
  {
    id: "owner/reports",
    path: "/reports",
    highlight: (page) => page.getByRole("link", { name: /^Month/ }),
    crop: main,
    badge: 2,
    alt: "Reports with the Month report highlighted.",
  },
  {
    id: "owner/report-month-counts",
    path: "/reports/month",
    highlight: (page) =>
      page
        .locator('[data-slot="team-month-row"]', { hasText: "Sample Member" })
        .locator('[data-slot="team-month-counts"]'),
    // The person's row alone: the month also lists people who have left (the flow tests' fixtures).
    crop: (page) => page.locator('[data-slot="team-month-row"]', { hasText: "Sample Member" }),
    badge: 3,
    alt: "The Month report with a person's four counts highlighted: Late, Left early, Early approved and Half days.",
  },
  {
    id: "owner/report-eod",
    path: () => `/reports/end-of-day/${todayIST()}`,
    highlight: (page) => slot(page, "eod-attendance"),
    crop: main,
    badge: 3,
    alt: "Today's End of day report with the Attendance section highlighted: the count line and each person's row with Late and Left early.",
  },
];
