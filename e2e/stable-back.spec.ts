import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";

import {
  holdReads,
  hydrated,
  ownSession,
  pageHeader,
  removeClientFixture,
  runInstalled,
  serviceInsert,
  serviceSelect,
  storageStateFor,
  USERS,
} from "./helpers";

/**
 * The back control survives its header streaming in (fix-stable-back, 26 Nov 2026; the cause of
 * CI 45754758589's `pre-hydration.spec:279`). A person's and a client's header used to stream in
 * behind a skeleton of the whole header, its own back link included: when the real header
 * arrived, React swapped that link for a new one. A press that went down on the skeleton's back
 * and came up after the swap landed on two different elements, so the browser fired no click and
 * the tap was lost (a slow phone, before hydration). Now the header, its back control and the bell
 * are drawn at once and only the record's parts stream in.
 *
 * The record's read is held at the e2e server's Supabase proxy (`holdReads`, this test's own
 * session) and the scripts never answered, so the header is still loading and the app is not
 * live when the pointer goes down. The hold is released between the pointer going down and up.
 */
test.use({ storageState: storageStateFor("owner") });
// The scripts are held by `page.route`; a service worker serving `/_next/static` from its cache
// would answer them out of Playwright's sight (as in `pre-hydration.spec.ts`).
test.use({ serviceWorkers: "block" });
// With the scripts held, the inline script makes a held tap's move itself as a document load.
test.use({ documentLoads: "allowed" });
test.skip(({ isMobile }) => !isMobile, "the installed app is a phone");

/** A person's leave page, found through the hydrated app. */
async function personUrl(page: Page) {
  await runInstalled(page);
  await page.goto("/today/people");
  await hydrated(page);
  await page.locator('[data-slot="board-row"]').first().click();
  await expect(page).toHaveURL(/\/people\/[^/]+\/leave$/);
  return page.url();
}

/** A client of this test's own, per project (the Owner sees every client). */
async function clientUrl(page: Page, project: string) {
  const name = `Stable back client (${project})`;
  await removeClientFixture(name);
  const [org] = await serviceSelect<{ id: string }>("organizations?select=id&limit=1");
  const { id } = await serviceInsert<{ id: string }>("clients", { org_id: org!.id, name });
  await runInstalled(page);
  await page.goto(`/clients/${id}`);
  await hydrated(page);
  return page.url();
}

const RECORDS = [
  { name: "a person", read: "/rest/v1/members", url: (page: Page) => personUrl(page) },
  { name: "a client", read: "/rest/v1/clients", url: clientUrl },
] as const;

for (const record of RECORDS) {
  test(`${record.name}: back pressed while the header streams in is still one tap on one control`, async ({
    page,
  }, info) => {
    const url = await record.url(page, info.project.name);
    const session = await ownSession(page, USERS.owner.email, USERS.owner.password);

    const fresh = await page.context().newPage();
    await runInstalled(fresh);
    // Never answered: the app cannot hydrate, so the press lands on the server's HTML.
    await fresh.route(/\/_next\/static\/chunks\/.+\.js/, () => {});
    await fresh.addInitScript(() => {
      const w = window as unknown as {
        __pressed?: Element | undefined;
        __clicked?: Element | undefined;
      };
      window.addEventListener(
        "pointerdown",
        (event) => {
          w.__pressed ??= (event.target as Element | null)?.closest("a[href]") ?? undefined;
        },
        true,
      );
      window.addEventListener(
        "click",
        (event) => {
          w.__clicked ??= (event.target as Element | null)?.closest("a[href]") ?? undefined;
        },
        true,
      );
    });

    const hold = await holdReads(record.read, session);
    try {
      await fresh.goto(url, { waitUntil: "commit" });
      const back = fresh.locator('[data-slot="page-back"]:visible');
      await expect(back).toBeVisible();
      await expect(back, "the press lands before hydration").not.toHaveAttribute("data-live");
      await expect(
        pageHeader(fresh).locator('[data-slot="skeleton"]').first(),
        "the header is still loading",
      ).toBeVisible();

      const box = await back.boundingBox();
      if (!box) throw new Error("the back control is not on screen");
      await fresh.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await fresh.mouse.down();
      await fresh.waitForFunction(() => "__pressed" in window);

      // The record arrives between the pointer going down and coming up.
      hold.release();
      await expect(pageHeader(fresh).locator("h1 [data-slot='skeleton']")).toHaveCount(0);
      expect(
        await fresh.evaluate(() => {
          const w = window as unknown as { __pressed?: Element };
          return w.__pressed?.isConnected === true;
        }),
        "the back control the pointer went down on is still on the page",
      ).toBe(true);

      await fresh.mouse.up();
      await fresh.waitForFunction(() => "__clicked" in window);
      expect(
        await fresh.evaluate(() => {
          const w = window as unknown as { __pressed?: Element; __clicked?: Element };
          return w.__clicked === w.__pressed;
        }),
        "the click lands on the control that was pressed",
      ).toBe(true);
    } finally {
      hold.release();
      await fresh.close();
    }
  });
}
