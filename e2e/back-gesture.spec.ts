import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";

import {
  CONTINUE_BUTTON,
  animationsSettled,
  expectBackStack,
  expectNoHorizontalScroll,
  followAuthLink,
  hydrated,
  recoveryLinkFor,
  resetAttendanceAndLeave,
  runInstalled,
  setPasswordFor,
  signIn,
  storageStateFor,
  startPrompt,
} from "./helpers";

/**
 * Back behaves like an app, not a website (task 1.5, ARCHITECTURE §14.1).
 *
 * Two rules, scoped differently on purpose:
 * - **Overlays close on back, everywhere.** A dialog or sheet swallows the back gesture instead
 *   of letting it navigate the page underneath.
 * - **Tabs do not stack up history, when installed only.** Back from any top-level tab returns
 *   to the role's home tab. In a browser tab the normal web back/forward is left alone, which is
 *   what the second half of this file checks.
 */

test.describe("overlays close on back", () => {
  test.use({ storageState: storageStateFor("owner") });
  // These reach the overlays through the bottom bar and the card list, which are phone layouts.
  // The rule itself is not phone-only: the desktop case is the last test in this file.
  test.skip(({ isMobile }) => !isMobile, "phone triggers; desktop is covered separately");

  test("the More sheet goes, the page underneath stays", async ({ page }) => {
    await page.goto("/today");
    await page.locator('[data-slot="bottom-nav"] [data-nav="more"]').click();
    const sheet = page.locator('[data-slot="more-sheet"]');
    await expect(sheet).toBeVisible();

    // The whole point: we dismissed an overlay, we did not navigate.
    await expectBackStack(page, [{ closes: sheet, url: /\/today$/ }]);
  });

  test("a sheet handing off to a dialog keeps the dialog open", async ({ page }) => {
    // Deactivate closes the detail sheet and opens a confirm in the same commit. Pushing and
    // popping per overlay made the closing sheet's asynchronous back() swallow the dialog's
    // entry, and the dialog disappeared the instant it opened.
    await page.goto("/people");
    await page.getByRole("button", { name: "More for Local Staff" }).click();
    const sheet = page.locator('[data-slot="detail-sheet"]');
    await expect(sheet).toBeVisible();

    await sheet.getByRole("button", { name: "Deactivate" }).click();
    const confirm = page.locator('[data-slot="dialog-content"]');
    await expect(confirm).toBeVisible();
    await expect(sheet).toBeHidden();

    // One overlay is open, so one back closes it and leaves the page alone.
    await expectBackStack(page, [{ closes: confirm, url: /\/people$/ }]);
  });

  test("the detail sheet still closes on back after navigating from the More sheet", async ({
    page,
  }) => {
    // The exact path from the installed app: reach People *through* the More sheet, which is a
    // close-and-navigate, then open a card. The navigation buries the sheet's spent entry, and
    // a stale count meant the detail sheet pushed no entry of its own — so back navigated to
    // the previous tab and left the sheet sitting there.
    await page.goto("/today");
    await page.locator('[data-slot="bottom-nav"] [data-nav="more"]').click();
    await page
      .locator('[data-slot="more-sheet"]')
      .getByRole("link", { name: "People", exact: true })
      .click();
    await expect(page).toHaveURL(/\/people$/);

    await page.getByRole("button", { name: "More for Local Staff" }).click();
    const sheet = page.locator('[data-slot="detail-sheet"]');
    await expect(sheet).toBeVisible();

    await expectBackStack(page, [{ closes: sheet, url: /\/people$/ }]);
  });

  test("after dismissing by hand, back still gets you off the page", async ({ page }) => {
    await page.goto("/today");
    await page.locator('[data-slot="bottom-nav"] [data-nav="more"]').click();
    const sheet = page.locator('[data-slot="more-sheet"]');
    await expect(sheet).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    // The entry the sheet opened over is left behind spent — it cannot be popped on close
    // without cancelling a navigation started from inside an overlay. `onPopState` skips it,
    // so one back press still leaves /today rather than being silently swallowed.
    await page.goto("/calendar");
    await expectBackStack(page, [{ url: /\/today$/ }]);
  });

  test("reopening reuses the spent entry instead of stacking more", async ({ page }) => {
    await page.goto("/today");
    const more = page.locator('[data-slot="bottom-nav"] [data-nav="more"]');
    const sheet = page.locator('[data-slot="more-sheet"]');

    for (let i = 0; i < 3; i++) {
      await more.click();
      await expect(sheet).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
    }

    // Dismissing by hand leaves one spent entry, and it carries the same URL as the page, so
    // the first back press is absorbed: it lands on /today again. The point of this test is
    // that three open/dismiss cycles still cost exactly one absorbed press, not three — the
    // spent entry is reused rather than a new one pushed each time.
    await expectBackStack(page, [{ url: /\/today$/ }]);
    await page.goBack();
    await expect(page).not.toHaveURL(/\/today$/);
  });
});

/**
 * The same rules in the installed app (the 2.3 fix, device-checked on a Galaxy S23 with gesture
 * navigation). Each case ends with one more back, to prove the overlay or view control left
 * nothing behind: that back navigates to wherever the member came from.
 */
test.describe("installed: overlays and view controls", () => {
  test.skip(({ isMobile }) => !isMobile, "the installed app is a phone");

  test.describe("as the Owner", () => {
    test.use({ storageState: storageStateFor("owner") });

    test("/people: back closes the detail sheet, the next back leaves", async ({ page }) => {
      await runInstalled(page);
      await page.goto("/today");
      await page.goto("/people");
      await page.getByRole("button", { name: "More for Local Staff" }).click();
      const sheet = page.locator('[data-slot="detail-sheet"]');
      await expect(sheet).toBeVisible();

      await expectBackStack(page, [{ closes: sheet, url: /\/people$/ }, { url: /\/today$/ }]);
    });

    test("/people through More: back closes the detail sheet", async ({ page }) => {
      await runInstalled(page);
      await page.goto("/today");
      await page.locator('[data-slot="bottom-nav"] [data-nav="more"]').click();
      await page
        .locator('[data-slot="more-sheet"]')
        .getByRole("link", { name: "People", exact: true })
        .click();
      await expect(page).toHaveURL(/\/people$/);
      await page.getByRole("button", { name: "More for Local Staff" }).click();
      const sheet = page.locator('[data-slot="detail-sheet"]');
      await expect(sheet).toBeVisible();

      await expectBackStack(page, [{ closes: sheet, url: /\/people$/ }]);
    });

    test("/settings/days-off: back closes the Add holiday dialog, the next back leaves", async ({
      page,
    }) => {
      await runInstalled(page);
      await page.goto("/settings");
      await page.goto("/settings/days-off");
      await page.getByRole("button", { name: "Add holiday" }).click();
      const dialog = page.getByRole("dialog", { name: "Add a holiday" });
      await expect(dialog).toBeVisible();

      await expectBackStack(page, [
        { closes: dialog, url: /\/settings\/days-off$/ },
        { url: /\/settings$/ },
      ]);
    });

    test("/settings/thresholds: editing the quiet hours adds no history; back returns to Settings", async ({
      page,
    }) => {
      // 5B decision 6. Typed here, never saved: the window is the organisation's, and only the
      // serial push-cron project may move it (push-quiet.spec), so no push elsewhere is held.
      await runInstalled(page);
      await page.goto("/settings");
      await page.getByRole("link", { name: "Thresholds", exact: true }).click();
      await expect(page).toHaveURL(/\/settings\/thresholds$/);
      const from = page.getByLabel("Quiet from");
      const until = page.getByLabel("Quiet until");
      await expect(from).toHaveValue("22:00");
      await expect(until).toHaveValue("07:00");
      await from.fill("23:00");
      await until.fill("06:30");
      await expect(page).toHaveURL(/\/settings\/thresholds$/);

      await expectBackStack(page, [{ url: /\/settings$/ }]);
    });

    test("/settings/notifications: back returns to Settings", async ({ page }) => {
      // 5.4: a Settings screen with no overlay or view control of its own.
      await runInstalled(page);
      await page.goto("/settings");
      // The section's row, not the bell (whose name is "Notifications" too).
      await page
        .locator('[data-slot="settings-section"]')
        .filter({ hasText: "Notifications" })
        .click();
      await expect(page).toHaveURL(/\/settings\/notifications$/);
      await expect(page.getByRole("heading", { name: "Can’t be reached" })).toBeVisible();

      await expectBackStack(page, [{ url: /\/settings$/ }]);
    });

    test("/settings/thresholds: back closes the open Default reminders, then returns to Settings", async ({
      page,
    }) => {
      // 5.3. Opened and looked at, never saved: the default is the organisation's.
      await runInstalled(page);
      await page.goto("/settings");
      await page.getByRole("link", { name: "Thresholds", exact: true }).click();
      await expect(page).toHaveURL(/\/settings\/thresholds$/);
      const summary = page.locator('[data-slot="reminder-summary"]');
      const rows = page.locator('[data-slot="reminder-row"]');
      expect((await summary.boundingBox())?.height).toBe(44);
      await summary.click();
      await expect(rows).not.toHaveCount(0);
      await expectNoHorizontalScroll(page);
      await page.goBack();
      await expect(rows).toHaveCount(0);
      await expect(page).toHaveURL(/\/settings\/thresholds$/);
      await expectBackStack(page, [{ url: /\/settings$/ }]);
    });

    test("/settings/task-types: in the Add dialog, back closes the open reminders, then the dialog", async ({
      page,
    }) => {
      await runInstalled(page);
      await page.goto("/settings");
      await page.getByRole("link", { name: "Task types", exact: true }).click();
      await expect(page).toHaveURL(/\/settings\/task-types$/);
      await page.getByRole("button", { name: "Add task type" }).click();
      const add = page.getByRole("dialog", { name: "Add a task type" });
      const summary = add.locator('[data-slot="reminder-summary"]');
      const rows = add.locator('[data-slot="reminder-row"]');
      expect((await summary.boundingBox())?.height).toBe(44);
      await summary.click();
      await expect(rows).toHaveCount(3);
      for (const scale of [130, 200]) {
        await page.evaluate((percent) => {
          document.documentElement.style.fontSize = `${percent}%`;
        }, scale);
        // A sheet's padding eases to the new text size (its footer's margin does not): measure
        // the settled layout, as every large-text check of a sheet does.
        await animationsSettled(page);
        await expectNoHorizontalScroll(page);
      }
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "";
      });
      await page.goBack();
      await expect(rows).toHaveCount(0);
      await expect(add).toBeVisible();
      await expectBackStack(page, [
        { closes: add, url: /\/settings\/task-types$/ },
        { url: /\/settings$/ },
      ]);
    });

    test("a confirm handed off from the sheet: back closes it, the URL stays", async ({ page }) => {
      await runInstalled(page);
      await page.goto("/people");
      await page.getByRole("button", { name: "More for Local Staff" }).click();
      await page
        .locator('[data-slot="detail-sheet"]')
        .getByRole("button", { name: "Deactivate" })
        .click();
      const confirm = page.locator('[data-slot="dialog-content"]');
      await expect(confirm).toBeVisible();
      // The hand-off: choosing an action closes the sheet and opens the confirm in its place.
      await expect(page.locator('[data-slot="detail-sheet"]')).toBeHidden();

      await expectBackStack(page, [{ closes: confirm, url: /\/people$/ }]);
    });
  });

  test.describe("as Staff", () => {
    test.use({ storageState: storageStateFor("staff") });

    /** My Day → the attendance strip: a real drill-down, so it pushes. */
    async function openLeave(page: Page) {
      await runInstalled(page);
      await page.goto("/my-day");
      await page.locator('[data-slot="attendance-strip"]').getByRole("link").click();
      await expect(page).toHaveURL(/\/leave\/attendance$/);
    }

    /** A view control: the URL follows, and the new view has rendered. */
    async function view(page: Page, name: string, url: RegExp) {
      await page.getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(url);
    }

    test("/leave: back closes a day's sheet, the next back returns to My Day", async ({ page }) => {
      await openLeave(page);
      await page.locator('[data-slot="data-card"]').first().click();
      const sheet = page.locator('[data-slot="detail-sheet"]');
      await expect(sheet).toBeVisible();

      await expectBackStack(page, [
        { closes: sheet, url: /\/leave\/attendance$/ },
        { url: /\/my-day$/ },
      ]);
    });

    test("/leave: tabs and months never add history; one back leaves", async ({ page }) => {
      await openLeave(page);
      await view(page, "Leave requests", /\/leave$/);
      await view(page, "Attendance", /\/leave\/attendance$/);
      await view(page, "Leave requests", /\/leave$/);
      await view(page, "Attendance", /\/leave\/attendance$/);
      // The seed dates everyone 40 days back, so there is always a previous month.
      await page.getByRole("link", { name: "Previous month" }).click();
      await expect(page).toHaveURL(/month=\d{4}-\d{2}$/);
      await page.getByRole("link", { name: "Next month" }).click();
      await expect(page.getByRole("link", { name: "Next month" })).toHaveCount(0);

      await expectBackStack(page, [{ url: /\/my-day$/ }]);
    });

    test("the Leave tab (5B): its tabs never add history; back returns to My Day, then leaves", async ({
      page,
    }) => {
      await runInstalled(page);
      await page.goto("/my-day");
      await page.locator('[data-slot="bottom-nav"] [data-nav="leave"]').click();
      await expect(page).toHaveURL(/\/leave$/);
      await view(page, "Attendance", /\/leave\/attendance$/);
      await view(page, "Leave requests", /\/leave$/);
      await view(page, "Attendance", /\/leave\/attendance$/);
      await expectBackStack(page, [{ url: /\/my-day$/ }, { url: /^about:blank$/ }]);
    });

    test("Me → Extra work & expenses (5B): its tabs never add history; back returns to Me, then My Day", async ({
      page,
    }) => {
      await runInstalled(page);
      await page.goto("/my-day");
      await page.locator('[data-slot="bottom-nav"] [data-nav="me"]').click();
      await expect(page).toHaveURL(/\/me$/);
      // A row of Me is a real drill-down: it pushes.
      await page.locator('[data-slot="me-work-link"]').click();
      await expect(page).toHaveURL(/\/leave\/extra-work$/);
      await view(page, "Expenses", /\/leave\/expenses$/);
      await view(page, "Extra work", /\/leave\/extra-work$/);
      await view(page, "Expenses", /\/leave\/expenses$/);
      await expectBackStack(page, [{ url: /\/me$/ }, { url: /\/my-day$/ }]);
    });
  });
});

/**
 * §14.2 e: one-time screens are never in the back stack. After sign-in (with the Start-day
 * prompt answered or not), a recovery link's Continue page, set-password or a sign-out the app
 * lands with nothing of ours underneath, so one back leaves (Playwright's page starts on about:blank; the installed app
 * would close). Each phone project has its own seeded person, whose day is cleared first and
 * whose password is put back.
 */
test.describe("installed: sign-in, the prompt, recovery and sign-out leave the back stack", () => {
  test.skip(({ isMobile }) => !isMobile, "the installed app is a phone");
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: { cookies: [], origins: [] } });

  const PASSWORD = "back-local-password";
  const PEOPLE: Record<string, { email: string; id: string }> = {
    mobile: { email: "back-mobile@maxoff.local", id: "20000000-0000-4000-8000-000000000016" },
    "mobile-lg": {
      email: "back-mobile-lg@maxoff.local",
      id: "20000000-0000-4000-8000-000000000017",
    },
  };
  const LEFT = { url: /^about:blank$/ };

  test("sign-in and Start day from the prompt: back from home leaves", async ({ page }, info) => {
    const who = PEOPLE[info.project.name]!;
    await resetAttendanceAndLeave(who.id);
    await runInstalled(page);
    await signIn(page, who.email, PASSWORD, { day: "stop" });
    await expect(page).toHaveURL(/\/my-day$/);
    // The prompt is a layer, not a page: back closes it and the next back leaves (§14.2 a, e).
    const prompt = startPrompt(page);
    await expect(prompt).toBeVisible();
    await expectBackStack(page, [{ closes: prompt, url: /\/my-day$/ }, LEFT]);
  });

  test("sign-in, prompt answered with Start day: back from home leaves", async ({ page }, info) => {
    const who = PEOPLE[info.project.name]!;
    await runInstalled(page);
    await signIn(page, who.email, PASSWORD);
    await expect(page).toHaveURL(/\/my-day$/);
    await expect(startPrompt(page)).toBeHidden();
    await expectBackStack(page, [LEFT]);
  });

  test("sign-in with the day settled: back from home leaves", async ({ page }, info) => {
    const who = PEOPLE[info.project.name]!;
    await runInstalled(page);
    await signIn(page, who.email, PASSWORD);
    await expect(page).toHaveURL(/\/my-day$/);
    await expectBackStack(page, [LEFT]);
  });

  test("sign-out: back from the sign-in page does not return to the app", async ({
    page,
  }, info) => {
    const who = PEOPLE[info.project.name]!;
    await runInstalled(page);
    await signIn(page, who.email, PASSWORD);
    // Me is a root (a bottom-bar tab): replace, so nothing of ours sits beneath the sign-in page.
    await page.locator('[data-slot="bottom-nav"] [data-nav="me"]').click();
    await expect(page).toHaveURL(/\/me$/);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login\?reason=signed_out$/);
    await expectBackStack(page, [LEFT]);
  });

  test("a recovery link's Continue page and set-password: back from each leaves", async ({
    page,
  }, info) => {
    const who = PEOPLE[info.project.name]!;
    await runInstalled(page);
    try {
      const link = await recoveryLinkFor(who.email);
      // The Continue page (3cB review) is a one-time screen with nothing of ours beneath it: one
      // back leaves, and leaves the link unspent, since only Continue verifies it.
      await page.goto(link);
      await expect(page.getByRole("button", { name: CONTINUE_BUTTON })).toBeVisible();
      await expectBackStack(page, [LEFT]);

      await followAuthLink(page, link);
      await expect(page).toHaveURL(/\/set-password$/);
      const fresh = `back-new-${crypto.randomUUID().slice(0, 8)}`;
      await page.getByLabel("New password").fill(fresh);
      await page.getByLabel("Repeat it").fill(fresh);
      await page.getByRole("button", { name: "Save password and sign in" }).click();
      await expect(page).toHaveURL(/\/my-day$/);
      await expectBackStack(page, [LEFT]);
    } finally {
      await setPasswordFor(who.id, PASSWORD);
    }
  });
});

/** §14.2 a: a menu or a select is a layer; back closes it before anything under it. */
test.describe("installed: menus and selects close on back", () => {
  test.skip(({ isMobile }) => !isMobile, "the installed app is a phone");
  test.use({ storageState: storageStateFor("staff") });

  test("a select inside a dialog: the select sheet, then the dialog, then the page", async ({
    page,
  }) => {
    await runInstalled(page);
    await page.goto("/my-day");
    await page.goto("/leave");
    await page.getByRole("button", { name: "Request leave" }).click();
    const dialog = page.getByRole("dialog", { name: "Request leave" });
    await dialog.getByRole("combobox", { name: "Kind of leave" }).click();
    // On a phone the select is a nested bottom sheet, its own layer (3B review).
    const sheet = page.locator('[data-slot="select-sheet"]');
    await expect(sheet.getByRole("listbox", { name: "Kind of leave" })).toBeVisible();

    await expectBackStack(page, [
      { closes: sheet, url: /\/leave$/ },
      { closes: dialog, url: /\/leave$/ },
      { url: /\/my-day$/ },
    ]);
  });

  test("a menu: back closes it, the next back leaves", async ({ page }) => {
    await runInstalled(page);
    await page.goto("/my-day");
    await page.goto("/me");
    // A tap before React has hydrated the page reaches no handler, on any build (reproduced
    // with the CPU slowed 4-16x on main before 6A and on 6A alike; CI runs 37575602126 and
    // 37587912609): the menu is tapped once the app is running, as the other specs do.
    await hydrated(page);
    await page.getByRole("button", { name: "Change theme" }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();

    await expectBackStack(page, [{ closes: menu, url: /\/me$/ }, { url: /\/my-day$/ }]);
  });

  test("a menu tapped while its screen is still hydrating opens on that tap", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "mobile", "one phone width shows it; the CPU is slowed 8x");
    // A slow phone: the shell is live but the screen's own part hydrates on the tap. The theme
    // menu loads after the page (6.0, `AfterPage`): it must never swap its stand-in away inside
    // that tap (CI runs 37575602126 and 37587912609; 4 of 16 opened before the fix).
    await runInstalled(page);
    await page.goto("/my-day");
    const cpu = await page.context().newCDPSession(page);
    await cpu.send("Emulation.setCPUThrottlingRate", { rate: 8 });
    await page.goto("/me");
    await hydrated(page);
    await page.getByRole("button", { name: "Change theme" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await cpu.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  });
});

/** §14.2 c: a page opened from More is a tab root: back goes to the home tab. */
test.describe("installed: More destinations are tab roots", () => {
  test.skip(({ isMobile }) => !isMobile, "the bottom bar is a phone layout");
  test.use({ storageState: storageStateFor("owner") });

  const openFromMore = async (page: Page, name: string) => {
    await page.locator('[data-slot="bottom-nav"] [data-nav="more"]').click();
    await page.locator('[data-slot="more-sheet"]').getByRole("link", { name, exact: true }).click();
  };
  const tapTab = async (page: Page, key: string, url: RegExp) => {
    await page.locator(`[data-slot="bottom-nav"] [data-nav="${key}"]`).click();
    await expect(page).toHaveURL(url);
  };

  test("from home: More → People, back lands on Today", async ({ page }) => {
    await runInstalled(page);
    await page.goto("/today");
    await openFromMore(page, "People");
    await expect(page).toHaveURL(/\/people$/);
    await expectBackStack(page, [{ url: /\/today$/ }]);
  });

  test("from another tab: More → People, back lands on Today, not the tab", async ({ page }) => {
    await runInstalled(page);
    await page.goto("/today");
    await tapTab(page, "calendar", /\/calendar$/);
    await openFromMore(page, "People");
    await expect(page).toHaveURL(/\/people$/);
    await expectBackStack(page, [{ url: /\/today$/ }]);
  });

  test("the profile row: More → Me, back lands on Today", async ({ page }) => {
    await runInstalled(page);
    await page.goto("/today");
    await tapTab(page, "calendar", /\/calendar$/);
    await openFromMore(page, "Me");
    await expect(page).toHaveURL(/\/me$/);
    await expectBackStack(page, [{ url: /\/today$/ }]);
  });

  test("a fast double tap lands once, with Today underneath", async ({ page }) => {
    await runInstalled(page);
    await page.goto("/today");
    await tapTab(page, "calendar", /\/calendar$/);
    await page.locator('[data-slot="bottom-nav"] [data-nav="more"]').click();
    await page
      .locator('[data-slot="more-sheet"]')
      .getByRole("link", { name: "People", exact: true })
      .dblclick();
    await expect(page).toHaveURL(/\/people$/);
    await expect(page.locator('[data-slot="more-sheet"]')).toBeHidden();
    await expectBackStack(page, [{ url: /\/today$/ }]);
    // Nothing doubled underneath: the next back leaves the app's tabs.
    await page.goBack().catch(() => {});
    await expect(page).not.toHaveURL(/\/(people|calendar|today)$/);
  });
});

test.describe("tab history", () => {
  test.use({ storageState: storageStateFor("owner") });
  // The bottom bar only exists below `md`.
  test.skip(({ isMobile }) => !isMobile, "the bottom bar is a phone layout");

  /** Taps a tab and waits for it to land: `goBack()` would otherwise race the navigation. */
  const tapTab = async (page: Page, key: string, url: RegExp) => {
    await page.locator(`[data-slot="bottom-nav"] [data-nav="${key}"]`).click();
    await expect(page).toHaveURL(url);
  };

  test("installed: back from any tab returns to the home tab", async ({ page }) => {
    await runInstalled(page);
    await page.goto("/today");

    await tapTab(page, "calendar", /\/calendar$/);
    await tapTab(page, "approvals", /\/approvals$/);

    // Three tabs visited, one back to leave them all: the tabs replaced each other over home.
    await expectBackStack(page, [{ url: /\/today$/ }]);
  });

  test("installed: back on the home tab leaves the app's pages", async ({ page }) => {
    await runInstalled(page);
    await page.goto("/today");
    await tapTab(page, "calendar", /\/calendar$/);
    await expectBackStack(page, [{ url: /\/today$/ }]);

    // A browser cannot be asked "did the app close?", so assert the assertable half: there is
    // nothing of ours left to go back to, so back does not land on another tab.
    await page.goBack().catch(() => {});
    await expect(page).not.toHaveURL(/\/(calendar|approvals)$/);
  });

  test("installed: a detail route inside a tab still pushes", async ({ page }) => {
    await runInstalled(page);
    await page.goto("/settings");
    await page.getByRole("link", { name: /Job titles/ }).click();
    await expect(page).toHaveURL(/\/settings\/job-titles$/);

    // Only top-level tabs are rewritten, so a nested route still pushes. NOTE: this is a
    // settings sub-page, not a record detail page — the app has none yet. The real case
    // (back from a client page returns to the client list, not to Today) has to be verified
    // when 3.4 ships that route; see PROGRESS.
    await expectBackStack(page, [{ url: /\/settings$/ }]);
  });

  test("in a browser tab: back retraces every step, as on any website", async ({ page }) => {
    // No runInstalled() here — this is the control, and the reason the rule is gated on
    // display-mode rather than on screen width.
    await page.goto("/today");
    await tapTab(page, "calendar", /\/calendar$/);
    await tapTab(page, "approvals", /\/approvals$/);

    await expectBackStack(page, [{ url: /\/calendar$/ }, { url: /\/today$/ }]);
    // Forward still works too, which the installed rule deliberately gives up.
    await page.goForward();
    await expect(page).toHaveURL(/\/calendar$/);
  });
});

test.describe("on desktop too", () => {
  test.use({ storageState: storageStateFor("owner") });
  test.skip(({ isMobile }) => Boolean(isMobile), "the phone cases are above");

  test("back closes a dialog instead of leaving the page", async ({ page }) => {
    await page.goto("/people");
    await page.getByRole("button", { name: "Add person", exact: true }).click();
    const dialog = page.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();

    await expectBackStack(page, [{ closes: dialog, url: /\/people$/ }]);
  });
});
