import { expect, test } from "@playwright/test";

/**
 * The theme is decided before first paint (task 1.5).
 *
 * The installed app painted light on every reload, then switched to dark. Two causes: our
 * pre-paint script returned early for the default `system`, and next-themes' own script renders
 * inside `<body>` where the provider is — measured at byte 3382 of the login document, after the
 * first `<div>` at 3247, so the browser already had paintable content to show.
 *
 * **What is asserted here, and what is not.** A frame-by-frame trace of the first 500 ms was
 * tried and abandoned: on desktop Chromium the document parses before first paint so the bug is
 * invisible, and under CPU throttling heavy enough to expose it the sampler became unreliable
 * (see PROGRESS). Rather than gate the build on a test that flakes, the decision the script makes
 * is unit-tested directly in `src/core/ui/theme/theme-color.test.ts`, and what is checked here is
 * the other half: that the script is in `<head>`, ahead of anything paintable. That assertion was
 * verified to fail against the pre-fix script.
 */
test("the pre-paint theme script is in <head>, ahead of any content", async ({ page }) => {
  const html = await (await page.request.get("/login")).text();
  const headEnd = html.indexOf("</head>");
  const ourScript = html.indexOf("classList.toggle");
  expect(ourScript, "the pre-paint script is missing from the document").toBeGreaterThan(-1);
  expect(ourScript, "the pre-paint script is not in <head>").toBeLessThan(headEnd);

  // next-themes' own script is in <body>, which is the reason ours has to exist at all.
  const nextThemes = html.indexOf('["light", "dark"]');
  if (nextThemes > -1) expect(nextThemes).toBeGreaterThan(headEnd);
});
