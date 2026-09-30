import { type Page, type TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

import { addISTDays, istInstant, todayIST } from "../src/core/time";

import {
  animationsSettled,
  expectNoHorizontalScroll,
  expectSettled,
  holdReads,
  hydrated,
  insertAs,
  memberIdOf,
  ownSession,
  removeRequestsTitled,
  removeTasksTitled,
  removeTemplatesNamed,
  rpcAs,
  type SessionRole,
  storageStateFor,
  taskTypeId,
  USERS,
} from "./helpers";

/**
 * Loading screens, held on screen (ARCHITECTURE §14.1; 4C review M1). Each route's `loading.tsx`
 * is opened the way a phone meets it on a cold open, and **held there by its data**: the test
 * signs the page in with a session of its own (`ownSession`) and holds that session's reads of
 * one PostgREST path the page (never the `(app)` layout) needs, at the e2e server's Supabase proxy
 * (`holdReads`, `e2e/hold-proxy.ts`). The page cannot answer, so React streams the loading screen
 * and it stays up; nothing races, and no other test is held. While it is up:
 *
 * - **It fits at large system text** (phones, 375 and 430px; §14.2 i): nothing reaches past the
 *   edge at 100%, 130% and 200% (the phase 3 review and the 3c review each caught a skeleton
 *   doing so on CI, only when the check ran before the page streamed in).
 * - **It traces its screen** (every width, the desktop included): the tops of the points it must
 *   meet (the first heading, the first row, …) are read held, the hold is released, and the
 *   settled page's are read at the same points: each is within `TRACE_TOLERANCE`. A header line
 *   the skeleton leaves out (the description, 4C review S7) or a row of the wrong height moves
 *   them and fails here.
 *
 * A screen whose settled page needs data to show what its skeleton traces makes it first, per
 * test (a title prefix with the project, the role and the path), and removes it after.
 */

test.describe.configure({ mode: "parallel" });

/**
 * How far a traced point may sit from the page's: a pixel either way. Everything in a skeleton
 * is sized to the page's own boxes (a bar inside a line box of the text's height, rows at the
 * row's minimum height, the same paddings), so the two meet exactly but for sub-pixel rounding
 * of rem sizes and a hairline border; one line of text is 16 to 20px, so a move a person can see
 * is well past this.
 */
const TRACE_TOLERANCE = 1;

/** A point the skeleton must meet: its selector while held, and the page's once settled. */
type Point = { held: string; settled: string };

type Fixture = "staff task" | "suggestion" | "template" | "task to check" | "task page";

type LoadingScreen = {
  role: SessionRole;
  /** The address; `:task` is the fixture's task (the task page's views). */
  path: string;
  /** An attribute of the route's loading screen, which marks it on screen. */
  marker: string;
  /** The PostgREST path of a read only the page makes, held until the checks are done. */
  hold: string;
  /** Where the skeleton meets the settled page (none: the page ends somewhere else). */
  trace: Readonly<Record<string, Point>>;
  fixture?: Fixture;
  /** What the settled page waits for before it is measured (a sheet that slides in). */
  settle?: (page: Page) => Promise<void>;
};

const TASKS_TEAM: Record<string, Point> = {
  "first heading": {
    held: '[data-slot="loading-tasks"] > section:first-child > :first-child',
    settled: '[data-slot="tasks-team"] > section:first-child > h2',
  },
  "first row": {
    held: '[data-slot="loading-tasks"] > section:first-child > :nth-child(2)',
    settled: '[data-slot="tasks-team"] > section:first-child > :nth-child(2)',
  },
};

const ALL_TASKS: Record<string, Point> = {
  "search and filters": {
    held: '[data-slot="loading-toolbar"]',
    settled: '[data-slot="data-toolbar"]',
  },
  "first row": {
    held: '[data-slot="loading-all-tasks"] [data-slot="loading-row"]',
    settled: '[data-slot="data-card"], [data-slot="table-row"]:has(td)',
  },
};

const REQUESTS: Record<string, Point> = {
  "first heading": {
    held: '[data-slot="loading-task-requests"] > :first-child',
    settled: '[data-slot="task-requests"] > section:first-child > h2',
  },
  "first row": {
    held: '[data-slot="loading-task-requests"] li',
    settled: '[data-slot="task-request"]',
  },
};

/**
 * A task's page (Kickoff 4 decisions 26–32, 31): the first glance, the views' bar and the view the
 * address asks for. The Staff member's task is theirs to note (the next step, a sticky bar on a
 * phone and a row from `md` up, is in the skeleton for Staff), due in three days, so the glance
 * is one line at 375px.
 */
const TASK_GLANCE: Record<string, Point> = {
  glance: {
    held: '[data-slot="loading-task-glance"]',
    settled: '[data-slot="task-summary"]',
  },
};

const TASK_VIEWS: Record<string, Point> = {
  ...TASK_GLANCE,
  "views bar": {
    held: '[data-slot="loading-task-tabs"]',
    settled: '[data-slot="task-tabs-band"]',
  },
};

const TASK_WORK: Record<string, Point> = {
  ...TASK_VIEWS,
  "first section": {
    held: '[data-slot="loading-task-work"] > :first-child',
    settled: '[data-slot="task-panel-work"] > section:first-child > :first-child',
  },
  "first stage": {
    held: '[data-slot="loading-task-work"] > :nth-child(2) > :first-child',
    settled: '[data-slot="task-stage"]',
  },
};

const ME: Record<string, Point> = {
  "profile card": {
    held: '[aria-label="Loading Me"] > [data-slot="card"]',
    settled: 'main [data-slot="card"]',
  },
};

const LOADING_SCREENS: readonly LoadingScreen[] = [
  // Today: the Owner's attendance card and people board (2.4) over the stand-in; an Admin's
  // strip (its End day reads the day's overtime note, only the page does) over theirs.
  {
    role: "owner",
    path: "/today",
    marker: 'data-slot="loading-stand-in"',
    hold: "/rest/v1/rpc/attendance_today_detail",
    trace: {
      "attendance card": {
        held: '[data-slot="loading-today-board"] > :first-child',
        settled: '[data-slot="today-attendance-card"]',
      },
      "board heading": {
        held: '[data-slot="loading-today-board"] > :nth-child(2)',
        settled: '[data-slot="people-board"] h2',
      },
      "first person": {
        held: '[data-slot="loading-today-board"] li',
        settled: '[data-slot="board-row"]',
      },
    },
  },
  {
    role: "admin",
    path: "/today",
    marker: 'data-slot="loading-stand-in"',
    hold: "/rest/v1/extra_work_notes",
    trace: {
      "attendance strip": {
        held: '[data-slot="attendance-strip-skeleton"]',
        settled: '[data-slot="attendance-strip"]',
      },
      "stand-in": {
        held: '[data-slot="loading-stand-in"]',
        settled: 'main [data-slot="empty-state"]',
      },
    },
  },
  // Me: the freelancers the member coordinates are read only here (4C).
  {
    role: "owner",
    path: "/me",
    marker: 'aria-label="Loading Me"',
    hold: "/rest/v1/coordinated_freelancers",
    trace: ME,
  },
  {
    role: "admin",
    path: "/me",
    marker: 'aria-label="Loading Me"',
    hold: "/rest/v1/coordinated_freelancers",
    trace: ME,
  },
  {
    role: "staff",
    path: "/me",
    marker: 'aria-label="Loading Me"',
    hold: "/rest/v1/coordinated_freelancers",
    trace: ME,
  },
  // A task's page (4.4): its skeleton streams before the page decides; an unknown id ends on the
  // not-found screen, so there is nothing to trace, only the fit (the Owner's ⋯ placeholder, and
  // Staff's none).
  {
    role: "owner",
    path: "/tasks/00000000-0000-4000-8000-000000000000",
    marker: 'aria-label="Loading the task"',
    hold: "/rest/v1/tasks",
    trace: {},
  },
  {
    role: "staff",
    path: "/tasks/00000000-0000-4000-8000-000000000000",
    marker: 'aria-label="Loading the task"',
    hold: "/rest/v1/tasks",
    trace: {},
  },
  // The reworked task page (decisions 26–32): each view, held by a read only it waits for, and
  // traced; Chat is the inline view on a desktop and the full-height sheet on a phone.
  {
    role: "staff",
    path: "/tasks/:task",
    marker: 'aria-label="Loading the task"',
    hold: "/rest/v1/task_stages",
    fixture: "task page",
    trace: TASK_WORK,
  },
  {
    role: "owner",
    path: "/tasks/:task",
    marker: 'aria-label="Loading the task"',
    hold: "/rest/v1/task_stages",
    fixture: "task page",
    // The Owner's "needed" line names the Staff member and may take two lines on a phone.
    trace: TASK_GLANCE,
  },
  {
    role: "staff",
    path: "/tasks/:task?tab=activity",
    marker: 'aria-label="Loading the task"',
    hold: "/rest/v1/activity_log",
    fixture: "task page",
    trace: {
      ...TASK_VIEWS,
      "first change": {
        held: '[data-slot="loading-task-activity"] > div > :first-child',
        settled: '[data-slot="task-history-row"]',
      },
    },
  },
  {
    role: "staff",
    path: "/tasks/:task?tab=details",
    marker: 'aria-label="Loading the task"',
    hold: "/rest/v1/task_assignees",
    fixture: "task page",
    trace: {
      ...TASK_VIEWS,
      "first person": {
        held: '[data-slot="loading-task-details"] > :first-child > :nth-child(2) > :first-child',
        settled: '[data-slot="task-person"]',
      },
    },
  },
  {
    role: "staff",
    path: "/tasks/:task?tab=chat",
    marker: 'aria-label="Loading the task"',
    hold: "/rest/v1/task_comments",
    fixture: "task page",
    settle: async (page) => {
      await expect(
        page.locator('[data-slot="task-chat-sheet"], [data-slot="task-panel-chat"]').filter({
          visible: true,
        }),
      ).toBeVisible();
      await animationsSettled(page);
    },
    trace: {
      ...TASK_GLANCE,
      "first comment": {
        held: '[data-slot="loading-task-chat"] > :first-child > :first-child, [data-slot="loading-task-chat-sheet"] > :nth-child(2) > div > :first-child',
        settled:
          '[data-slot="task-panel-chat"] [data-slot="task-comment"], [data-slot="task-chat-sheet"] [data-slot="task-comment"]',
      },
    },
  },
  // The Tasks tab (4.5) per role: the Owner's and an Admin's "Needs you" (always there, whatever
  // it holds), Staff's first group (their own task, not noted).
  {
    role: "owner",
    path: "/tasks",
    marker: 'aria-label="Loading tasks"',
    hold: "/rest/v1/tasks",
    trace: TASKS_TEAM,
  },
  {
    role: "admin",
    path: "/tasks",
    marker: 'aria-label="Loading tasks"',
    hold: "/rest/v1/tasks",
    trace: TASKS_TEAM,
  },
  {
    role: "staff",
    path: "/tasks",
    marker: 'aria-label="Loading tasks"',
    hold: "/rest/v1/tasks",
    fixture: "staff task",
    trace: {
      "first heading": {
        held: '[data-slot="loading-tasks"] > section:first-child > :first-child',
        settled: '[data-slot="tasks-mine"] > section:first-child > h2',
      },
      "first row": {
        held: '[data-slot="loading-tasks"] > section:first-child > :nth-child(2)',
        settled: '[data-slot="tasks-mine"] > section:first-child > :nth-child(2)',
      },
    },
  },
  // The full list: its toolbar, then cards on a phone and the table from `md` up.
  {
    role: "owner",
    path: "/tasks/all",
    marker: 'data-slot="loading-all-tasks"',
    hold: "/rest/v1/tasks",
    fixture: "staff task",
    trace: ALL_TASKS,
  },
  {
    role: "staff",
    path: "/tasks/all",
    marker: 'data-slot="loading-all-tasks"',
    hold: "/rest/v1/tasks",
    fixture: "staff task",
    trace: ALL_TASKS,
  },
  // 4.6: Suggested tasks per role, Settings → Task types (the Owner's) and → Templates.
  {
    role: "owner",
    path: "/tasks/requests",
    marker: 'data-slot="loading-task-requests"',
    hold: "/rest/v1/task_requests",
    fixture: "suggestion",
    trace: REQUESTS,
  },
  {
    role: "admin",
    path: "/tasks/requests",
    marker: 'data-slot="loading-task-requests"',
    hold: "/rest/v1/task_requests",
    fixture: "suggestion",
    trace: REQUESTS,
  },
  {
    role: "staff",
    path: "/tasks/requests",
    marker: 'data-slot="loading-task-requests"',
    hold: "/rest/v1/task_requests",
    fixture: "suggestion",
    trace: REQUESTS,
  },
  {
    role: "owner",
    path: "/settings/task-types",
    marker: 'data-slot="loading-task-types"',
    hold: "/rest/v1/task_types",
    trace: {
      "first row": {
        held: '[data-slot="loading-task-types"] li',
        settled: '[data-slot="task-type"]',
      },
    },
  },
  {
    role: "owner",
    path: "/settings/templates",
    marker: 'data-slot="loading-templates"',
    hold: "/rest/v1/task_templates",
    fixture: "template",
    trace: {
      "first row": {
        held: '[data-slot="loading-templates"] li',
        settled: '[data-slot="task-template"]',
      },
    },
  },
  {
    role: "admin",
    path: "/settings/templates",
    marker: 'data-slot="loading-templates"',
    hold: "/rest/v1/task_templates",
    fixture: "template",
    trace: {
      "first row": {
        held: '[data-slot="loading-templates"] li',
        settled: '[data-slot="task-template"]',
      },
    },
  },
  // An Admin's Approvals: the one group, the tasks they check (4.5).
  {
    role: "admin",
    path: "/approvals",
    marker: 'data-slot="loading-approvals"',
    hold: "/rest/v1/tasks",
    fixture: "task to check",
    trace: {
      "group heading": {
        held: '[data-slot="loading-approval-group"] > :first-child',
        settled: '[data-slot="approval-group"] > :first-child',
      },
      "first row": {
        held: '[data-slot="loading-approval-group"] li',
        settled: '[data-slot="approval-row"]',
      },
    },
  },
];

function prefixOf(info: TestInfo, screen: LoadingScreen): string {
  return `Held ${info.project.name} ${screen.role} ${screen.path} `;
}

/**
 * A short, unique task title for a task page fixture ("Ta" + a hash of the prefix): the page's
 * title bar is traced, and a long title would wrap on a phone.
 */
function shortTag(prefix: string): string {
  let hash = 0;
  for (const char of prefix) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ` ${hash.toString(36)}`;
}

/** Makes what the settled page needs; resolves with its removal (and the task, if any). */
async function makeFixture(
  prefix: string,
  fixture: Fixture,
): Promise<{ remove: () => Promise<void>; task?: string }> {
  const { owner, admin, staff } = USERS;
  if (fixture === "suggestion") {
    await rpcAs(staff.email, staff.password, "task_request_create", { title: `${prefix}reel` });
    return { remove: () => removeRequestsTitled(prefix) };
  }
  if (fixture === "template") {
    await insertAs(owner.email, owner.password, "task_templates", {
      name: `${prefix}template`,
      task_type_id: await taskTypeId("Normal"),
    });
    return { remove: () => removeTemplatesNamed(prefix) };
  }
  const staffId = await memberIdOf(staff.email);
  const id = await rpcAs<string>(owner.email, owner.password, "task_create", {
    // The task page traces its title bar: a title that fits one line on a phone.
    title: fixture === "task page" ? `${prefix.slice(0, 2)}${shortTag(prefix)}` : `${prefix}task`,
    description: null,
    task_type_id: await taskTypeId("Normal"),
    client_id: null,
    priority: "medium",
    due_at: istInstant(addISTDays(todayIST(), 3), "18:00"),
    assignee_ids: [staffId],
    primary_owner_id: staffId,
    approving_admin_id: fixture === "task to check" ? await memberIdOf(admin.email) : null,
    ...(fixture === "task page" ? { stages: ["Rough cut", "Colour grade"] } : {}),
  });
  // Handed in: it waits for the Admin's check.
  if (fixture === "task to check") {
    await rpcAs(staff.email, staff.password, "task_submit_done", { task_id: id });
  }
  // The task page's Chat: the Owner's comment and the Staff member's reply.
  if (fixture === "task page") {
    await insertAs(owner.email, owner.password, "task_comments", {
      task_id: id,
      body: "Please use the drone shots too.",
    });
    await insertAs(staff.email, staff.password, "task_comments", {
      task_id: id,
      body: "Will do.",
    });
  }
  return {
    remove: () =>
      removeTasksTitled(
        fixture === "task page" ? `${prefix.slice(0, 2)}${shortTag(prefix)}` : prefix,
      ),
    task: id,
  };
}

/** Each point's top (document coordinates) on its first visible match, or null. */
async function topsOf(page: Page, selectors: Record<string, string>) {
  return page.evaluate((points) => {
    const tops: Record<string, number | null> = {};
    for (const [name, selector] of Object.entries(points)) {
      const element = [...document.querySelectorAll<HTMLElement>(selector)].find((candidate) => {
        const box = candidate.getBoundingClientRect();
        return box.height > 0 && candidate.checkVisibility();
      });
      tops[name] = element ? element.getBoundingClientRect().top + window.scrollY : null;
    }
    return tops;
  }, selectors);
}

function pick(trace: Readonly<Record<string, Point>>, side: keyof Point): Record<string, string> {
  return Object.fromEntries(Object.entries(trace).map(([name, point]) => [name, point[side]]));
}

for (const role of ["owner", "admin", "staff"] as const) {
  test.describe(`${role}: loading screens, held`, () => {
    test.use({ storageState: storageStateFor(role) });

    for (const screen of LOADING_SCREENS.filter((entry) => entry.role === role)) {
      test(`${screen.path}: fits at large text and traces its screen`, async ({ page }, info) => {
        const user = USERS[role];
        const phone = (page.viewportSize()?.width ?? 1280) < 768;
        const prefix = prefixOf(info, screen);
        if (screen.path === "/today" && role === "admin") {
          // The strip reads the overtime note only while End day is its action: the seeded
          // Admin's day is started by `auth.setup.ts` and never ended by a spec.
          const [day] = await rpcAs<{ started_at: string | null; ended_at: string | null }[]>(
            user.email,
            user.password,
            "attendance_own_today",
            {},
          );
          expect(day?.started_at, "the seeded Admin's day is started (auth.setup)").toBeTruthy();
          expect(day?.ended_at, "and not ended").toBeNull();
        }
        const made = screen.fixture ? await makeFixture(prefix, screen.fixture) : null;
        const remove = made?.remove;
        const path = screen.path.replace(":task", made?.task ?? ":task");
        const session = await ownSession(page, user.email, user.password);
        const held = await holdReads(screen.hold, session);
        try {
          await page.goto(path, { waitUntil: "commit" });
          const loading = page.locator(`[${screen.marker}]`);
          await expect(loading).toBeVisible();
          await expect
            .poll(() => held.caught(), { message: `the page's ${screen.hold} read is held` })
            .toBe(true);
          const skeleton = await topsOf(page, pick(screen.trace, "held"));
          if (phone) {
            for (const scale of [100, 130, 200]) {
              await page.evaluate((percent) => {
                document.documentElement.style.fontSize = `${percent}%`;
              }, scale);
              await expectNoHorizontalScroll(page);
            }
            await page.evaluate(() => {
              document.documentElement.style.fontSize = "";
            });
          }

          held.release();
          await expect(loading).toHaveCount(0);
          if (Object.keys(screen.trace).length === 0) return;
          await expectSettled(page);
          // What the page settles to, hydrated: a control may still take its final size then.
          await hydrated(page);
          await screen.settle?.(page);
          const settled = await topsOf(page, pick(screen.trace, "settled"));
          const moved = Object.keys(screen.trace).flatMap((name) => {
            const from = skeleton[name];
            const to = settled[name];
            if (from === null || from === undefined) return [`${name}: not in the skeleton`];
            if (to === null || to === undefined) return [`${name}: not on the page`];
            return Math.abs(to - from) > TRACE_TOLERANCE
              ? [`${name}: ${from.toFixed(1)} → ${to.toFixed(1)}`]
              : [];
          });
          expect(moved, "nothing moves when the data arrives").toEqual([]);
        } finally {
          held.release();
          await remove?.();
        }
      });
    }
  });
}
