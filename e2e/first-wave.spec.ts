import { expect, test } from "./fixtures";

import {
  firstWave,
  memberIdOf,
  ownSession,
  rpcAs,
  serviceInsert,
  serviceSelect,
  storageStateFor,
  taskTypeId,
  USERS,
} from "./helpers";
import { addISTDays, istInstant, todayIST } from "../src/core/time";

/**
 * The first wave of 20 routes, for each role that opens them (v2.0 X3 (a), ARCHITECTURE §19 "Six
 * connections"): the 16 paths in `ROUTES` and the four records in `RECORDS` (a task, a client, a
 * project, a person). The other routes are not covered yet; their first wave is a v2.1 item
 * (ROADMAP, v2.1 "Reliable anywhere"). A Worker sets off at most six database requests at a time,
 * so a route whose first wave holds a seventh waits a whole extra round trip for it. Counted at
 * the e2e server's proxy as a **wave** (`firstWave`): every database read of this test's own
 * session is held unanswered, so the reads that arrive are exactly the ones the request starts
 * before any answer could start another; then the hold ends and the page answers.
 *
 * **The gate is on (v2.0 X6, the advisor's batch 5):** each covered route's first wave is at most
 * six reads, holds the shell's one `session_early` and no member-row read beside it, and reads
 * nothing twice. One test per route and role. The wave counts once one quiet window has passed and
 * a second one adds nothing (a slow runner's straggler would show as a moved count, never as a
 * smaller one). Each route's reads go into the test's annotations.
 */
const MAX_FIRST_WAVE = 6;

const LEADS = ["owner", "admin"] as const;
/** `getSessionState`'s own member-row read (`readMemberRow`), the one `session_early()` replaces. */
const MEMBER_ROW_READ =
  /^\/rest\/v1\/members\?select=id,email,full_name,role,status,avatar_file_id,job_title/;
type Role = "owner" | "admin" | "staff";

const ROUTES: { path: string; roles: readonly Role[] }[] = [
  { path: "/today", roles: LEADS },
  { path: "/my-day", roles: ["staff"] },
  { path: "/approvals", roles: LEADS },
  { path: "/tasks", roles: ["owner", "admin", "staff"] },
  { path: "/calendar", roles: ["owner", "admin", "staff"] },
  { path: "/clients", roles: LEADS },
  { path: "/people", roles: LEADS },
  { path: "/reports", roles: LEADS },
  { path: "/leave", roles: ["admin", "staff"] },
  { path: "/leave/attendance", roles: ["admin", "staff"] },
  { path: "/leave/extra-work", roles: ["admin", "staff"] },
  { path: "/leave/expenses", roles: ["admin", "staff"] },
  { path: "/settings", roles: LEADS },
  { path: "/settings/templates", roles: LEADS },
  { path: "/me", roles: ["owner", "admin", "staff"] },
  { path: "/notifications", roles: ["owner", "admin", "staff"] },
];

/** This spec's own records (neutral names), made once and found again on a used database. */
const FIXTURE = "First wave fixture";

/**
 * A task (the Owner's, for the seeded Crew member, approved through the seeded Admin) and an
 * Active client of the seeded Admin's with one project: so every role's record pages are measured
 * on any database, never only when an earlier spec left one behind (a reset seed has none).
 */
async function fixtures(): Promise<{ task: string; client: string; project: string }> {
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
  const [client] = await serviceSelect<{ id: string }>(
    `clients?name=eq.${encodeURIComponent(FIXTURE)}&select=id&limit=1`,
  );
  let clientId = client?.id;
  if (!clientId) {
    const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
    const row = await serviceInsert<{ id: string }>("clients", {
      org_id: org?.id,
      name: FIXTURE,
      admin_id: await memberIdOf(USERS.admin.email),
    });
    await rpcAs(USERS.owner.email, USERS.owner.password, "client_activate", { client_id: row.id });
    clientId = row.id;
  }
  const [project] = await serviceSelect<{ id: string }>(
    `projects?client_id=eq.${clientId}&select=id&limit=1`,
  );
  const projectId =
    project?.id ??
    (await rpcAs<string>(USERS.admin.email, USERS.admin.password, "project_create", {
      client_id: clientId,
      name: FIXTURE,
      recurrence: "monthly",
      stages: [],
      items: ["First wave item"],
    }));
  return { task: taskId, client: clientId, project: projectId };
}

/** A record of each kind the role can open: this spec's own task and client, and a person. */
const RECORDS = {
  "a task": async () => `/tasks/${(await fixtures()).task}`,
  "a client": async () => `/clients/${(await fixtures()).client}`,
  "a project": async () => {
    const own = await fixtures();
    return `/clients/${own.client}/projects/${own.project}`;
  },
  "a person": async (role: Role) => {
    const id = await memberIdOf(USERS[role].email);
    const [person] = await serviceSelect<{ id: string }>(
      `members?status=eq.active&id=neq.${id}&select=id&limit=1`,
    );
    expect(person, "an active person to open").toBeTruthy();
    return `/people/${person!.id}`;
  },
} as const;
const RECORDS_OF: Record<Role, (keyof typeof RECORDS)[]> = {
  owner: ["a task", "a client", "a project", "a person"],
  admin: ["a task", "a client", "a project", "a person"],
  staff: ["a task"],
};

for (const role of ["owner", "admin", "staff"] as const) {
  test.describe(`the first wave, as ${role}`, () => {
    test.use({ storageState: storageStateFor(role) });
    const routes: { name: string; path: (role: Role) => Promise<string> }[] = [
      ...ROUTES.filter((route) => route.roles.includes(role)).map((route) => ({
        name: route.path,
        path: async () => route.path,
      })),
      ...RECORDS_OF[role].map((kind) => ({ name: kind, path: RECORDS[kind] })),
    ];
    for (const route of routes) {
      test(`${route.name}: at most ${MAX_FIRST_WAVE} first reads, none twice (${role})`, async ({
        page,
      }, info) => {
        test.skip(
          !["desktop", "mobile", "mobile-lg"].includes(info.project.name),
          "the three widths only",
        );
        const session = await ownSession(page, USERS[role].email, USERS[role].password);
        const path = await route.path(role);
        const wave = await firstWave(session);
        try {
          const answer = page.request.get(path, { maxRedirects: 0 }).catch(() => null);
          // Settled: a quiet window, then a second one that adds nothing.
          const first = await wave.settled();
          const reads = await wave.settled();
          expect(reads.length, `${path}: the wave held still across two quiet windows`).toBe(
            first.length,
          );
          const queries = wave.queries();
          info.annotations.push({
            type: "first-wave",
            description: `${String(reads.length).padStart(2)}  ${path}  ${reads.join(" ")}`,
          });
          // v2.0 X3 (advisor, #89): a full page makes the shell's one early read, never a second
          // one and never the member row's read beside it, whichever of the layout and the page
          // asks first (`startShellRead`).
          expect(
            reads.filter((read) => read === "/rest/v1/rpc/session_early").length,
            `${path}: one session_early`,
          ).toBe(1);
          expect(
            queries.filter((query) => MEMBER_ROW_READ.test(decodeURIComponent(query))).length,
            `${path}: no member-row read beside it`,
          ).toBe(0);
          expect(
            queries.filter((query, index) => queries.indexOf(query) !== index),
            `${path}: no read twice`,
          ).toEqual([]);
          expect(reads.length, `${path}: ${reads.join(" ")}`).toBeLessThanOrEqual(MAX_FIRST_WAVE);
          wave.release();
          const response = await answer;
          expect(response?.status(), `${path} answers once released`).toBe(200);
        } finally {
          wave.release();
        }
      });
    }
  });
}
