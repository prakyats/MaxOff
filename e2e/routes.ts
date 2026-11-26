import { expect } from "@playwright/test";

import { memberIdOf, rpcAs, serviceInsert, serviceSelect, taskTypeId, USERS } from "./helpers";
import { addISTDays, istInstant, todayIST } from "../src/core/time";

/**
 * Every screen a signed-in member can open, for each role that may open it (v7.0: one catalogue
 * for the specs that walk every route: the first wave and the accessibility checks). The roles
 * follow each page's own guard (`requirePermission`, the role checks) and `ROLE_GRANTS`; a page a
 * role may not open is not listed for it. Redirect-only addresses (`/settings/stage-presets`,
 * `/clients/:id/activity`, `/people/:id/leave`) and the framework's own pages (`/forbidden`,
 * `/open`, `/offline`) are left out: they draw nothing of their own.
 */
export type Role = "owner" | "admin" | "staff";

const ALL = ["owner", "admin", "staff"] as const;
const LEADS = ["owner", "admin"] as const;
const OWNER = ["owner"] as const;
const SELF = ["admin", "staff"] as const;

export type StaticRoute = { path: string; roles: readonly Role[] };

export const STATIC_ROUTES: readonly StaticRoute[] = [
  { path: "/today", roles: LEADS },
  { path: "/today/people", roles: OWNER },
  { path: "/my-day", roles: ["staff"] },
  { path: "/approvals", roles: LEADS },
  { path: "/tasks", roles: ALL },
  { path: "/tasks/all", roles: ALL },
  { path: "/tasks/requests", roles: ALL },
  { path: "/calendar", roles: ALL },
  { path: "/clients", roles: LEADS },
  { path: "/clients/items", roles: LEADS },
  { path: "/clients/items/decide", roles: LEADS },
  { path: "/people", roles: LEADS },
  { path: "/reports", roles: LEADS },
  { path: "/reports/end-of-day", roles: OWNER },
  { path: "/reports/month", roles: OWNER },
  // v2.1 (9.2): the Owner's Revenue page.
  { path: "/reports/revenue", roles: OWNER },
  { path: "/leave", roles: SELF },
  { path: "/leave/attendance", roles: SELF },
  { path: "/leave/extra-work", roles: SELF },
  { path: "/leave/expenses", roles: SELF },
  { path: "/settings", roles: LEADS },
  { path: "/settings/company", roles: OWNER },
  { path: "/settings/custom-fields", roles: LEADS },
  { path: "/settings/days-off", roles: OWNER },
  { path: "/settings/expenses", roles: OWNER },
  { path: "/settings/job-titles", roles: LEADS },
  { path: "/settings/notifications", roles: LEADS },
  { path: "/settings/task-types", roles: OWNER },
  { path: "/settings/templates", roles: LEADS },
  { path: "/settings/thresholds", roles: OWNER },
  { path: "/me", roles: ALL },
  { path: "/me/guide", roles: ALL },
  { path: "/notifications", roles: ALL },
];

/** The routes a signed-out visitor sees. */
export const SIGNED_OUT_ROUTES = ["/login", "/forgot-password"] as const;

/** The catalogue's own records (neutral names), made once and found again on a used database. */
const FIXTURE = "First wave fixture";

type Fixtures = { task: string; client: string; project: string; contact: string };
let made: Promise<Fixtures> | undefined;

/**
 * A task (the Owner's, for the seeded Crew member, approved through the seeded Admin) and an
 * Active client of the seeded Admin's with one project and one contact: so every role's record
 * pages are opened on any database, never only when an earlier spec left one behind (a reset seed
 * has none). Made once per worker.
 */
export function routeFixtures(): Promise<Fixtures> {
  made ??= makeFixtures();
  return made;
}

async function makeFixtures(): Promise<Fixtures> {
  const [task] = await serviceSelect<{ id: string }>(
    `tasks?title=eq.${encodeURIComponent(FIXTURE)}&select=id&limit=1`,
  );
  const staff = await memberIdOf(USERS.staff.email);
  const taskId =
    task?.id ??
    (await rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
      title: FIXTURE,
      description: null,
      task_type_id: await taskTypeId("Normal"),
      client_id: null,
      priority: "medium",
      due_at: istInstant(addISTDays(todayIST(), 20), "18:00"),
      assignee_ids: [staff],
      primary_owner_id: staff,
      approving_admin_id: await memberIdOf(USERS.admin.email),
      stages: [],
    }));
  const findClient = async () =>
    (
      await serviceSelect<{ id: string; org_id: string }>(
        `clients?name=eq.${encodeURIComponent(FIXTURE)}&select=id,org_id&limit=1`,
      )
    )[0];
  let client = await findClient();
  if (!client) {
    const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
    // Another worker may make it first (a fresh database; the name is unique): then it is used.
    const row = await serviceInsert<{ id: string }>("clients", {
      org_id: org?.id,
      name: FIXTURE,
      admin_id: await memberIdOf(USERS.admin.email),
    }).catch(() => null);
    if (row) {
      await rpcAs(USERS.owner.email, USERS.owner.password, "client_activate", {
        client_id: row.id,
      });
      client = { id: row.id, org_id: org!.id };
    } else {
      client = await findClient();
      expect(client, "the fixture client, made by another worker").toBeTruthy();
    }
  }
  const clientId = client!.id;
  const orgId = client!.org_id;
  // Made by another worker a moment ago: it may not be Active yet.
  await expect
    .poll(
      async () =>
        (await serviceSelect<{ state: string }>(`clients?id=eq.${clientId}&select=state`))[0]
          ?.state,
    )
    .toBe("active");
  const findProject = async () =>
    (
      await serviceSelect<{ id: string }>(
        `projects?client_id=eq.${clientId}&select=id&order=created_at.asc&limit=1`,
      )
    )[0]?.id;
  // Another worker may make it between the look and the create (a fresh database): the
  // database refuses a second open project of the name, and the first one is used.
  const projectId =
    (await findProject()) ??
    (await rpcAs<string>(USERS.admin.email, USERS.admin.password, "project_create", {
      client_id: clientId,
      name: FIXTURE,
      recurrence: "monthly",
      stages: [],
      items: ["First wave item"],
    }).catch(async (error: unknown) => {
      const made = await findProject();
      if (made) return made;
      throw error;
    }));
  const [contact] = await serviceSelect<{ id: string }>(
    `client_contacts?client_id=eq.${clientId}&select=id&limit=1`,
  );
  const contactId =
    contact?.id ??
    (
      await serviceInsert<{ id: string }>("client_contacts", {
        org_id: orgId,
        client_id: clientId,
        name: FIXTURE,
        is_primary: true,
      })
    ).id;
  return { task: taskId, client: clientId, project: projectId, contact: contactId };
}

/** Another active person the role can open. */
async function aPerson(role: Role): Promise<string> {
  const id = await memberIdOf(USERS[role].email);
  const [person] = await serviceSelect<{ id: string }>(
    `members?status=eq.active&role=eq.staff&id=neq.${id}&select=id&limit=1`,
  );
  expect(person, "an active person to open").toBeTruthy();
  return person!.id;
}

export type RecordRoute = {
  name: string;
  roles: readonly Role[];
  path: (role: Role) => Promise<string>;
};

/** The record pages, each found through the catalogue's own fixtures. */
export const RECORD_ROUTES: readonly RecordRoute[] = [
  { name: "a task", roles: ALL, path: async () => `/tasks/${(await routeFixtures()).task}` },
  {
    name: "a client",
    roles: LEADS,
    path: async () => `/clients/${(await routeFixtures()).client}`,
  },
  {
    name: "a client's projects",
    roles: LEADS,
    path: async () => `/clients/${(await routeFixtures()).client}/projects`,
  },
  {
    name: "a client's brand",
    roles: LEADS,
    path: async () => `/clients/${(await routeFixtures()).client}/brand`,
  },
  {
    name: "a contact",
    roles: LEADS,
    path: async () => {
      const own = await routeFixtures();
      return `/clients/${own.client}/contacts/${own.contact}`;
    },
  },
  {
    name: "a project",
    roles: LEADS,
    path: async () => {
      const own = await routeFixtures();
      return `/clients/${own.client}/projects/${own.project}`;
    },
  },
  { name: "a person", roles: LEADS, path: async (role) => `/people/${await aPerson(role)}` },
  {
    name: "a person's attendance",
    roles: OWNER,
    path: async (role) => `/people/${await aPerson(role)}/attendance`,
  },
  {
    name: "a person's month",
    roles: OWNER,
    path: async (role) => `/people/${await aPerson(role)}/month`,
  },
  {
    name: "an end-of-day report",
    roles: OWNER,
    path: async () => `/reports/end-of-day/${addISTDays(todayIST(), -1)}`,
  },
];

/** Every route the role opens: the static paths, then the records. */
export function routesFor(role: Role): { name: string; path: (role: Role) => Promise<string> }[] {
  return [
    ...STATIC_ROUTES.filter((route) => route.roles.includes(role)).map((route) => ({
      name: route.path,
      path: async () => route.path,
    })),
    ...RECORD_ROUTES.filter((route) => route.roles.includes(role)),
  ];
}
