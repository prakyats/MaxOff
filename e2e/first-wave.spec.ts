import { expect, test } from "./fixtures";

import { firstWave, ownSession, storageStateFor, USERS } from "./helpers";
import { routesFor } from "./routes";

/**
 * The first wave of every route, for each role that opens it (v2.0 X3 (a), ARCHITECTURE §19 "Six
 * connections"; v7.0 extended it from v2.0's 20 routes to the whole catalogue in `routes.ts`). A Worker sets off at most six database requests at a time,
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

/** `getSessionState`'s own member-row read (`readMemberRow`), the one `session_early()` replaces. */
const MEMBER_ROW_READ =
  /^\/rest\/v1\/members\?select=id,email,full_name,role,status,avatar_file_id,job_title/;

for (const role of ["owner", "admin", "staff"] as const) {
  test.describe(`the first wave, as ${role}`, () => {
    test.use({ storageState: storageStateFor(role) });
    const routes = routesFor(role);
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
