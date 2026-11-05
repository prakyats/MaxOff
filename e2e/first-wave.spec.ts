import { expect, test } from "./fixtures";

import {
  firstWave,
  memberIdOf,
  ownSession,
  serviceSelect,
  storageStateFor,
  USERS,
} from "./helpers";

/**
 * The first wave of every route for every role (v2.0 X3 (a), ARCHITECTURE §19 "Six
 * connections"): a Worker sets off at most six database requests at a time, so a route whose
 * first wave holds a seventh waits a whole extra round trip for it. Counted at the e2e server's
 * proxy as a **wave** (`firstWave`): every database read of this test's own session is held
 * unanswered, so the reads that arrive are exactly the ones the request starts before any answer
 * could start another; then the hold ends and the page answers.
 *
 * Measuring first (the numbers go into the report and the test's annotations); the ≤ 6 assertion
 * is switched on once every route is within it.
 */

const LEADS = ["owner", "admin"] as const;
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

/** A record of each kind the role can open, read with the service role (the seeded data). */
async function records(role: Role): Promise<string[]> {
  const id = await memberIdOf(USERS[role].email);
  const paths: string[] = [];
  const [task] = await serviceSelect<{ id: string }>(
    role === "staff"
      ? `tasks?primary_owner_id=eq.${id}&select=id&limit=1`
      : role === "admin"
        ? `tasks?or=(approving_admin_id.eq.${id},created_by.eq.${id})&select=id&limit=1`
        : "tasks?select=id&limit=1",
  );
  if (task) paths.push(`/tasks/${task.id}`);
  if (role === "staff") return paths;
  const [client] = await serviceSelect<{ id: string }>(
    role === "admin"
      ? `clients?admin_id=eq.${id}&state=eq.active&select=id&limit=1`
      : "clients?state=eq.active&select=id&limit=1",
  );
  if (client) {
    paths.push(`/clients/${client.id}`);
    const [project] = await serviceSelect<{ id: string }>(
      `projects?client_id=eq.${client.id}&select=id&limit=1`,
    );
    if (project) paths.push(`/clients/${client.id}/projects/${project.id}`);
  }
  const [person] = await serviceSelect<{ id: string }>(
    `members?status=eq.active&id=neq.${id}&select=id&limit=1`,
  );
  if (person) paths.push(`/people/${person.id}`);
  return paths;
}

for (const role of ["owner", "admin", "staff"] as const) {
  test.describe(`the first wave, as ${role}`, () => {
    test.use({ storageState: storageStateFor(role) });

    test(`every route's first wave (${role})`, async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "one width measures it: the server is the same");
      test.setTimeout(180_000);
      const session = await ownSession(page, USERS[role].email, USERS[role].password);
      const paths = [
        ...ROUTES.filter((route) => route.roles.includes(role)).map((route) => route.path),
        ...(await records(role)),
      ];
      const counts: Record<string, string[]> = {};
      for (const path of paths) {
        const wave = await firstWave(session);
        try {
          const answer = page.request.get(path, { maxRedirects: 0 }).catch(() => null);
          counts[path] = await wave.settled();
          wave.release();
          const response = await answer;
          expect(response?.status(), `${path} answers once released`).toBe(200);
        } finally {
          wave.release();
        }
      }
      const lines = Object.entries(counts).map(
        ([path, reads]) => `${String(reads.length).padStart(2)}  ${path}  ${reads.join(" ")}`,
      );
      info.annotations.push({ type: "first-wave", description: lines.join("\n") });
      // eslint-disable-next-line no-console -- the measuring run's table (X3), until the gate is on
      console.log(`first wave, ${role}:\n${lines.join("\n")}`);
    });
  });
}
