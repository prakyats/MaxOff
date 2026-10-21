import type { Locator, Page } from "@playwright/test";

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
  /** Leave the Start-day prompt open (only the picture of the prompt itself). */
  readonly keepStartPrompt?: boolean;
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

// ── The pictures ───────────────────────────────────────────────────────────────────────────────

export const GUIDE_SHOT_LIST: readonly GuideShot[] = [
  // Crew
  {
    id: "staff/start-day",
    path: "/my-day",
    keepStartPrompt: true,
    highlight: (page) => slot(page, "start-day-prompt").getByRole("button", { name: "Start day" }),
    crop: (page) => slot(page, "start-day-prompt"),
    alt: "The Started working? prompt with the Start day button highlighted.",
  },
  {
    id: "staff/my-day",
    path: "/my-day",
    highlight: (page) => slot(page, "attendance-strip"),
    crop: main,
    alt: "My Day with today's attendance strip highlighted at the top.",
  },
  {
    id: "staff/alerts",
    path: "/notifications",
    highlight: (page) => slot(page, "mark-all-read"),
    crop: main,
    alt: "Alerts, the list of notifications, with Mark all read highlighted.",
  },
  {
    id: "staff/end-day",
    path: "/my-day",
    prepare: (page) => tap(page, "End day"),
    highlight: (page) => layer(page).getByRole("button", { name: "End day", exact: true }),
    crop: layer,
    alt: "The End your day? confirmation with the End day button highlighted.",
  },
  {
    id: "staff/request-leave",
    path: "/leave",
    prepare: (page) => tap(page, "Request leave"),
    highlight: (page) => layer(page).getByLabel("Kind of leave"),
    crop: layer,
    alt: "The Request leave form with the Kind of leave field highlighted.",
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
    // The first day with tasks due: the sheet opens on them, then Who's free and the buttons.
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
    alt: "A client's page with its tabs highlighted: Overview, Projects, Brand and Activity.",
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
    highlight: (page) => layer(page).getByRole("button", { name: "Mark done", exact: true }),
    crop: layer,
    alt: "A deliverable's sheet with its stages and the Mark done button highlighted.",
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
    path: "/settings/templates",
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
    alt: "Today with the attendance counts highlighted.",
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
    prepare: (page) => tap(page, "New task"),
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
    highlight: (page) => layer(page).getByRole("combobox", { name: "Start from" }),
    crop: layer,
    alt: "The New project form with the Start from field highlighted.",
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
    path: "/settings/templates",
    highlight: (page) => button(page, "Preview Monthly reels"),
    crop: main,
    alt: "Templates with a project template's Preview button highlighted.",
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
    alt: "Thresholds with the Acknowledgement reminder (hours) field highlighted.",
  },
  {
    id: "owner/reports",
    path: "/reports",
    highlight: (page) => page.getByRole("link", { name: /^Month/ }),
    crop: main,
    alt: "Reports with the Month report highlighted.",
  },
];
