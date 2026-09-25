import { expect, type Locator, type Page, test } from "@playwright/test";

import { pageHeader, storageStateFor } from "./helpers";

/**
 * The mobile standard (ARCHITECTURE §14.1, task 1.5). Runs in the `mobile` project at **375px**
 * and the `mobile-lg` project at **430px**, because the rules are about a layout fitting, and
 * the two phone sizes are where it stops fitting.
 *
 * These are shell-level rules every screen inherits, so a failure here is a failure of the
 * foundation, not of one page. Screens built in later phases join the sweeps below by being
 * added to `SCREENS`.
 */

/** 44 x 44 px, the minimum touch target. */
const TARGET = 44;

/**
 * The bottom edge of a locator, in viewport coordinates, once it has stopped moving. Sheets
 * slide in, so a box read the instant they become visible is still mid-animation — measuring
 * that once produced a 9px "overflow" that did not exist.
 */
async function settledBottom(locator: Locator): Promise<number> {
  let previous = Number.NaN;
  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox();
        const bottom = Math.round((box?.y ?? 0) + (box?.height ?? 0));
        const settled = bottom === previous;
        previous = bottom;
        return settled;
      },
      { message: "the sheet finishes animating" },
    )
    .toBe(true);
  return previous;
}
/** 16px, below which iOS Safari zooms the page on focus and never zooms back. */
const MIN_INPUT_FONT = 16;

test.describe.configure({ mode: "parallel" });

/** Fails if the page can be scrolled sideways at all: no clipped columns, no wide table. */
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    // Whatever is actually sticking out, so a failure names the culprit.
    wide: [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}${el.dataset.slot ? `[${el.dataset.slot}]` : ""}`),
  }));
  expect(overflow.wide, "nothing reaches past the right edge").toEqual([]);
  expect(overflow.scrollWidth, "the page does not scroll sideways").toBeLessThanOrEqual(
    overflow.clientWidth,
  );
}

/**
 * Every control you can actually tap is at least 44 x 44. Inline text links are excluded: they
 * are prose, not targets, and §14.1 lists "icon buttons, table row actions and nav items".
 */
async function expectTouchTargets(page: Page): Promise<void> {
  const small = await page.evaluate((min) => {
    const selector =
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]';
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((el) => {
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
        // Inline links inside a paragraph, and the skip link, are not touch targets.
        if (style.display === "inline") return false;
        if (el.dataset.variant === "link") return false;
        const box = el.getBoundingClientRect();
        // Screen-reader-only elements (the skip link) are clipped to 1px and are a keyboard
        // affordance, not something anyone taps.
        if (box.width <= 1 && box.height <= 1) return false;
        if (box.width === 0 || box.height === 0) return false;
        if (box.width >= min && box.height >= min) return false;
        // A 16px checkbox inside a 44px label is reached by tapping the label, which is the
        // whole target. What matters is the area a thumb can hit, not the painted box.
        const label = el.closest("label");
        if (label) {
          const outer = label.getBoundingClientRect();
          if (outer.width >= min && outer.height >= min) return false;
        }
        return true;
      })
      .slice(0, 8)
      .map((el) => {
        const box = el.getBoundingClientRect();
        const name = el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 24) ?? "";
        return `${el.tagName.toLowerCase()} "${name}" ${Math.round(box.width)}x${Math.round(box.height)}`;
      });
  }, TARGET);
  expect(small, `every tappable control is at least ${TARGET}px`).toEqual([]);
}

/** Every text entry is at least 16px, or iOS zooms in on focus and never comes back. */
async function expectNoZoomOnFocus(page: Page): Promise<void> {
  const small = await page.evaluate((min) => {
    const selector =
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea';
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((el) => el.getBoundingClientRect().height > 0)
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < min)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}[name=${el.getAttribute("name")}] ${getComputedStyle(el).fontSize}`,
      );
  }, MIN_INPUT_FONT);
  expect(small, `every input is at least ${MIN_INPUT_FONT}px`).toEqual([]);
}

/** The screens that exist after phase 1, with the role that may open each. */
const SCREENS = [
  { path: "/people", role: "owner" },
  { path: "/settings", role: "owner" },
  { path: "/settings/company", role: "owner" },
  { path: "/settings/days-off", role: "owner" },
  { path: "/settings/thresholds", role: "owner" },
  { path: "/settings/job-titles", role: "owner" },
  { path: "/me", role: "staff" },
  { path: "/my-day", role: "staff" },
  { path: "/today", role: "admin" },
] as const;

for (const role of ["owner", "admin", "staff"] as const) {
  const screens = SCREENS.filter((screen) => screen.role === role);
  if (screens.length === 0) continue;

  test.describe(`${role} screens meet the mobile standard`, () => {
    test.use({ storageState: storageStateFor(role) });

    for (const { path } of screens) {
      test(`${path}: no sideways scroll, 44px targets, 16px inputs`, async ({ page }) => {
        await page.goto(path);
        await expect(pageHeader(page)).toBeVisible();
        await expectNoHorizontalScroll(page);
        await expectTouchTargets(page);
        await expectNoZoomOnFocus(page);
      });
    }
  });
}

test.describe("the bottom bar, for every role", () => {
  // The owner's stated priority order (2026-09-23). Clients is not in the bar for either role.
  const EXPECTED = {
    owner: ["Today", "Approvals", "Tasks", "Calendar", "More"],
    admin: ["Today", "Approvals", "Tasks", "Calendar", "More"],
    staff: ["My Day", "Tasks", "Calendar", "Alerts", "Me"],
  } as const;

  for (const role of ["owner", "admin", "staff"] as const) {
    test.describe(`as ${role}`, () => {
      test.use({ storageState: storageStateFor(role) });

      test("shows this role's destinations and no sidebar", async ({ page }) => {
        await page.goto(role === "staff" ? "/my-day" : "/today");

        await expect(page.locator('[data-slot="sidebar"]')).toBeHidden();
        const nav = page.locator('[data-slot="bottom-nav"]');
        await expect(nav).toBeVisible();

        // Exactly these, in this order — the split lives in `MOBILE_PRIMARY` in `nav.ts`.
        await expect(nav.locator("li")).toHaveCount(EXPECTED[role].length);
        for (const [index, label] of EXPECTED[role].entries()) {
          await expect(nav.locator("li").nth(index)).toContainText(label);
        }

        // Flush with the bottom of the viewport, under the safe area.
        const box = await nav.boundingBox();
        const viewport = page.viewportSize();
        expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(viewport?.height);
      });

      test("the current destination is marked", async ({ page }) => {
        await page.goto(role === "staff" ? "/my-day" : "/today");
        const nav = page.locator('[data-slot="bottom-nav"]');
        await expect(nav.locator("[data-nav=today], [data-nav=my-day]")).toHaveAttribute(
          "aria-current",
          "page",
        );
      });
    });
  }
});

test.describe("More, for Owner and Admin", () => {
  for (const role of ["owner", "admin"] as const) {
    test.describe(`as ${role}`, () => {
      test.use({ storageState: storageStateFor(role) });

      test("holds the rest of the navigation, profile and Log out", async ({ page }) => {
        await page.goto("/today");
        await page.locator('[data-slot="bottom-nav"] [data-nav="more"]').click();

        const sheet = page.locator('[data-slot="more-sheet"]');
        await expect(sheet).toBeVisible();
        // The rest of the navigation, in the same priority order as the bar, then the profile.
        await expect(sheet.getByRole("link")).toHaveText([
          "Reports",
          "Clients",
          "People",
          "Settings",
          "Me",
        ]);
        // Log out is a recorded attendance action (WORKFLOWS §1), so it is one tap from the bar.
        await expect(sheet.getByRole("button", { name: /Log out/ })).toBeVisible();

        await sheet.getByRole("link", { name: "People", exact: true }).click();
        await expect(page).toHaveURL(/\/people$/);
      });

      test("Appearance names the mode it is in, and changing it updates the row", async ({
        page,
      }) => {
        await page.goto("/today");
        await page.locator('[data-slot="bottom-nav"] [data-nav="more"]').click();

        const sheet = page.locator('[data-slot="more-sheet"]');
        // Not just an icon: the row says which mode you are in without a tap.
        await expect(sheet).toContainText(/Appearance · (Light|Dark|System)/);

        await sheet.getByRole("button", { name: "Change theme" }).click();
        await page.getByRole("menuitemradio", { name: "Dark" }).click();
        await expect(sheet).toContainText("Appearance · Dark");
      });

      test("Log out asks first, and cancelling leaves you signed in", async ({ page }) => {
        await page.goto("/today");
        await page.locator('[data-slot="bottom-nav"] [data-nav="more"]').click();
        await page
          .locator('[data-slot="more-sheet"]')
          .getByRole("button", { name: "Log out" })
          .click();

        // It records the time (WORKFLOWS §1), so a mis-tap must not be able to do it.
        const confirm = page.getByRole("alertdialog");
        await expect(confirm).toContainText("records your logout time");
        // The sheet got out of the way rather than stacking behind the confirmation.
        await expect(page.locator('[data-slot="more-sheet"]')).toBeHidden();

        await confirm.getByRole("button", { name: "Cancel" }).click();
        await expect(page).toHaveURL(/\/today$/);
        await expect(page.locator('[data-slot="bottom-nav"]')).toBeVisible();
      });

      test("only Approvals can carry a count today (2.4; Alerts join in 5.1)", async ({ page }) => {
        await page.goto("/today");
        // Whether a count shows depends on what other specs left waiting; where it shows does not.
        const badges = page.locator('[data-slot="bottom-nav"] [data-slot="nav-badge"]');
        const onApprovals = page.locator(
          '[data-slot="bottom-nav"] [data-nav="approvals"] [data-slot="nav-badge"]',
        );
        await expect(badges).toHaveCount(await onApprovals.count());
        expect(await badges.count()).toBeLessThanOrEqual(1);
      });

      test("More reads as current while one of its screens is open", async ({ page }) => {
        await page.goto("/people");
        await expect(page.locator('[data-slot="bottom-nav"] [data-nav="more"]')).toHaveAttribute(
          "data-active",
          "",
        );
      });
    });
  }

  test.describe("as staff", () => {
    test.use({ storageState: storageStateFor("staff") });

    test("Staff have no More: their five destinations are the whole app", async ({ page }) => {
      await page.goto("/my-day");
      await expect(page.locator('[data-slot="bottom-nav"] [data-nav="more"]')).toHaveCount(0);
      await expect(page.locator('[data-slot="bottom-nav"] [data-nav="me"]')).toBeVisible();
    });
  });
});

test.describe("the page title bar", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("the first row of real content is visible without scrolling", async ({ page }) => {
    await page.goto("/people");
    const firstCard = page.locator('[data-slot="data-card"]').first();
    const box = await firstCard.boundingBox();
    // Brand bar (48) + title bar (44) + a little breathing room. Before 1.5 a title, a two-line
    // description and a button pushed the first row past 200px.
    expect(box?.y ?? 0).toBeLessThan(140);
  });

  /**
   * The bar can only hide on a page long enough to scroll. At full phone height the nine seeded
   * people fit on one screen, so these use a short viewport: the behaviour is about scrolling,
   * not about width, and both projects still run them.
   */
  const SHORT = { height: 500 };

  /**
   * Opens a long-enough page and waits until the scroll handler is actually attached. The
   * attribute appears when `MobileChrome` mounts, so its presence is the hydration signal: a
   * wheel sent before that scrolls the page with nobody listening, and the bar then measures
   * from the new position and never moves.
   */
  async function openScrollable(page: Page): Promise<void> {
    await page.setViewportSize({ width: page.viewportSize()?.width ?? 375, ...SHORT });
    await page.goto("/people");
    await expect(page.locator("html")).toHaveAttribute("data-chrome", "shown");
  }

  test("the brand bar hides on a flick down and comes back on a flick up", async ({ page }) => {
    await openScrollable(page);
    const html = page.locator("html");

    // A fast flick, not a slow drag: one large scroll event, which is what a thumb produces.
    await page.mouse.wheel(0, 600);
    await expect(html).toHaveAttribute("data-chrome", "hidden");
    // The title bar has taken the top edge.
    const header = await pageHeader(page).boundingBox();
    expect(Math.round(header?.y ?? -1)).toBe(0);

    await page.mouse.wheel(0, -80);
    await expect(html).toHaveAttribute("data-chrome", "shown");
  });

  test("a small wobble does not flicker the bar", async ({ page }) => {
    await openScrollable(page);
    await page.mouse.wheel(0, 600);
    await expect(page.locator("html")).toHaveAttribute("data-chrome", "hidden");
    for (const delta of [4, -4, 5, -3, 4]) await page.mouse.wheel(0, delta);
    await expect(page.locator("html")).toHaveAttribute("data-chrome", "hidden");
  });

  test("scrolling back to the top always brings it back", async ({ page }) => {
    await openScrollable(page);
    await page.mouse.wheel(0, 600);
    await expect(page.locator("html")).toHaveAttribute("data-chrome", "hidden");
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator("html")).toHaveAttribute("data-chrome", "shown");
  });

  test("a sub-page offers the way back in the title bar", async ({ page }) => {
    await page.goto("/settings/job-titles");
    await page.getByRole("link", { name: "Back to Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
  });
});

test.describe("People is a card list, not a table", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("rows are cards and the table is not rendered", async ({ page }) => {
    await page.goto("/people");
    await expect(page.locator('[data-slot="data-cards"]')).toBeVisible();
    await expect(page.locator("table")).toBeHidden();
    await expect(page.locator('[data-slot="data-card"]').first()).toContainText("Prishit Shetty");
    await expectNoHorizontalScroll(page);
  });

  test("a card opens a detail sheet with the rest of the row and its actions", async ({ page }) => {
    await page.goto("/people");
    await page.locator('[data-slot="data-card"]', { hasText: "Local Staff" }).click();

    const sheet = page.locator('[data-slot="detail-sheet"]');
    await expect(sheet).toBeVisible();
    // The columns a phone has no room for live here (PERMISSIONS §2: the Owner sees email).
    await expect(sheet).toContainText("staff@maxoff.local");
    await expect(sheet).toContainText("Staff");
    // And the actions, which were a hover-adjacent 32px dropdown on desktop.
    await expect(sheet.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Deactivate" })).toBeVisible();

    // Anchored to the bottom of the viewport: a bottom sheet, not a centred dialog.
    expect(await settledBottom(sheet)).toBe(page.viewportSize()?.height);
  });

  test("an Admin's cards carry no email and no actions (PERMISSIONS §2)", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStateFor("admin") });
    const page = await context.newPage();
    await page.goto("/people");
    await page.locator('[data-slot="data-card"]', { hasText: "Local Staff" }).click();

    const sheet = page.locator('[data-slot="detail-sheet"]');
    await expect(sheet).toBeVisible();
    await expect(sheet).not.toContainText("@maxoff.local");
    await expect(sheet.locator('[data-slot="detail-sheet-actions"]')).toHaveCount(0);
    await context.close();
  });

  test("the primary action is at the bottom, above the bar", async ({ page }) => {
    await page.goto("/people");
    const fab = page.locator('[data-slot="page-actions"]');
    await expect(fab).toBeVisible();

    const box = await fab.boundingBox();
    const nav = await page.locator('[data-slot="bottom-nav"]').boundingBox();
    const viewport = page.viewportSize();
    // In the bottom third of the screen and clear of the bar.
    expect(box?.y ?? 0).toBeGreaterThan((viewport?.height ?? 0) * 0.66);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(nav?.y ?? 0);
  });
});

test.describe("dialogs are bottom sheets", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("the invite dialog opens from the bottom edge and scrolls inside itself", async ({
    page,
  }) => {
    await page.goto("/people");
    await page
      .locator('[data-slot="page-actions"]')
      .getByRole("button", { name: /Invite/ })
      .click();

    const dialog = page.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();

    const viewport = page.viewportSize();
    // Flush with the bottom and the full width: a sheet under the thumb, not a centred box.
    expect(await settledBottom(dialog)).toBe(viewport?.height);
    const box = await dialog.boundingBox();
    expect(Math.round(box?.width ?? 0)).toBe(viewport?.width);
    // It never grows past the viewport; its own scroll takes over, and does not chain.
    expect(box?.height ?? 0).toBeLessThanOrEqual((viewport?.height ?? 0) * 0.85 + 1);
    await expect(dialog).toHaveCSS("overscroll-behavior-y", "contain");
  });

  test("a confirm sheet keeps the destructive button clear of the thumb", async ({ page }) => {
    await page.goto("/settings/job-titles");
    await page
      .getByRole("button", { name: /^Actions for/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Archive" }).click();

    const dialog = page.locator('[data-slot="alert-dialog-content"]');
    await expect(dialog).toBeVisible();

    const confirm = await dialog.getByRole("button", { name: "Archive" }).boundingBox();
    const cancel = await dialog.getByRole("button", { name: "Cancel" }).boundingBox();
    // Cancel sits below Confirm, so the thumb rests on the harmless one (§14.1).
    expect(cancel?.y ?? 0).toBeGreaterThan(confirm?.y ?? 0);
  });
});

test.describe("Settings is a list of rows", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("each section is one tappable row that opens it", async ({ page }) => {
    await page.goto("/settings");
    const sections = page.locator('[data-slot="settings-section"]');
    // One element per section, not a mobile copy and a desktop copy.
    await expect(sections.filter({ hasText: "Company" })).toHaveCount(1);
    await sections.filter({ hasText: "Company" }).click();
    await expect(page).toHaveURL(/\/settings\/company$/);
  });

  test("the explanation is behind the help sheet, not above the first row", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "About this screen" }).click();
    await expect(page.locator('[data-slot="help-sheet"]')).toContainText("Everything configurable");
  });
});

test.describe("forms", () => {
  test.use({ storageState: storageStateFor("owner") });

  test("a long form keeps Save on screen", async ({ page }) => {
    await page.goto("/settings/thresholds");
    const bar = page.locator('[data-slot="sticky-actions"]');
    await expect(bar).toBeVisible();

    const nav = await page.locator('[data-slot="bottom-nav"]').boundingBox();
    const box = await bar.boundingBox();
    // Sitting directly on the bar, within a pixel of sub-pixel layout rounding.
    expect(Math.abs((box?.y ?? 0) + (box?.height ?? 0) - (nav?.y ?? 0))).toBeLessThanOrEqual(1);

    // Still there after scrolling to the end of the form.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(bar).toBeVisible();
  });
});

test.describe("nothing is hover-only", () => {
  test.use({ storageState: storageStateFor("owner") });

  /** Anything that only appears on `:hover` is unreachable on a phone (§14.1). */
  async function expectNoHoverOnly(locator: Locator): Promise<void> {
    await expect(locator).toBeVisible();
  }

  test("row actions are reachable by tap on People and on a list", async ({ page }) => {
    await page.goto("/people");
    await page.locator('[data-slot="data-card"]').first().click();
    await expectNoHoverOnly(page.locator('[data-slot="detail-sheet-actions"]'));

    await page.goto("/settings/job-titles");
    await expectNoHoverOnly(page.getByRole("button", { name: /^Actions for/ }).first());
  });
});

test.describe("password fields can be revealed", () => {
  // Signed out: the sign-in screen is where a mistyped password actually locks people out.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the eye toggles visibility without disturbing autofill", async ({ page }) => {
    await page.goto("/login");
    const field = page.locator('input[name="password"]');
    const toggle = page.locator('[data-slot="password-toggle"]');

    // Hidden by default: revealing is a deliberate act.
    await expect(field).toHaveAttribute("type", "password");
    await expect(toggle).toHaveAttribute("aria-label", "Show password");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    const box = await toggle.boundingBox();
    expect(box?.width ?? 0, "toggle width").toBeGreaterThanOrEqual(TARGET);
    expect(box?.height ?? 0, "toggle height").toBeGreaterThanOrEqual(TARGET);

    await field.fill("a-real-password");
    await toggle.click();

    await expect(field).toHaveAttribute("type", "text");
    await expect(toggle).toHaveAttribute("aria-label", "Hide password");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    // What password managers key off must not move when the field is revealed.
    await expect(field).toHaveAttribute("autocomplete", "current-password");
    await expect(field).toHaveAttribute("name", "password");
    await expect(field).toHaveValue("a-real-password");

    await toggle.click();
    await expect(field).toHaveAttribute("type", "password");
  });

  test("the toggle does not submit the form", async ({ page }) => {
    // A bare <button> inside a form defaults to submit, which would post an empty sign-in.
    await page.goto("/login");
    await page.locator('[data-slot="password-toggle"]').click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('[data-slot="field-error"]')).toHaveCount(0);
  });
});
