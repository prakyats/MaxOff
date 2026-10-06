import { expect, test } from "./fixtures";
import {
  acceptFixtureInvite,
  fencePerson,
  hydrated,
  inviteFixturePerson,
  removeFixturePerson,
  serviceRest,
  serviceSelect,
  signIn,
} from "./helpers";

/**
 * The harness's removal of a spec's own person (`removeFixturePerson`) holds while that person's
 * page still writes (main CI, 2026-10-06: onboarding.spec's cleanup failed its member delete, 409
 * on `activity_log_actor_id_fkey`). The cause, reproduced here: the app-open report (5.4) is a
 * background write the page sends once it opens, audited with the person as the actor; one that
 * lands after the cleanup's `activity_log` delete leaves a row the member delete cannot pass.
 * Removal now fences the person at the e2e server's Supabase proxy first (`fencePerson`): their
 * write sent after it writes nothing, so the deletes that follow always pass.
 *
 * Desktop only: it checks the harness, not a screen.
 */
const PASSWORD = "cleanup-local-password";

test("a person's late background write never breaks their removal", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "a harness check: one project is enough");
  const email = "cleanup-late-write@maxoff.local";
  const { id } = await inviteFixturePerson(email, "Cleanup Late Write");
  await acceptFixtureInvite(id, email, PASSWORD);

  // Their app-open report, held in the browser until the removal has begun.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const sent = new Promise<void>((resolve) => {
    void page.route("**/api/app-report", async (route) => {
      resolve();
      await gate;
      await route.continue();
    });
  });
  await signIn(page, email, PASSWORD);
  await hydrated(page);
  await sent;

  // The removal's first steps, then the report goes through: before the fence this wrote an
  // audit row with them as the actor, and the member delete answered 409.
  await fencePerson(id);
  await serviceRest(`activity_log?actor_id=eq.${id}`, { method: "DELETE" });
  const answered = page.waitForResponse("**/api/app-report");
  release();
  expect((await answered).ok()).toBe(false);
  expect(await serviceSelect(`activity_log?actor_id=eq.${id}&select=id`)).toEqual([]);
  expect(await serviceSelect(`member_app_reports?member_id=eq.${id}&select=member_id`)).toEqual([]);

  await removeFixturePerson(email);
  expect(await serviceSelect(`members?id=eq.${id}&select=id`)).toEqual([]);
});
